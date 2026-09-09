const assert = require("assert");
const Module = require("module");

/*
 * Proves the retention sweep archives the customer -> vehicle link BEFORE it
 * deletes the policy, and that a failed archive write aborts the delete.
 *
 * This ordering is the whole safety guarantee of Feature 2: the Policy row is
 * the only thing linking a customer to a vehicle, so if the archive is lost the
 * Create Policy dropdown silently empties.
 */

const CUSTOMER = "507f1f77bcf86cd799439011";
const VEHICLE = "507f1f77bcf86cd799439022";

const expiredLongAgo = {
  _id: "policy-1",
  policyNumber: "CUV-OLD-1",
  customerId: CUSTOMER,
  vehicleId: VEHICLE,
  status: "Expired",
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-01-01"),
  startTime: "09:00",
  endTime: "11:00",
};

let callLog = [];
let archiveShouldFail = false;
let policies = [];

const makeCursor = (rows) => {
  let index = 0;
  return {
    next: async () => (index < rows.length ? rows[index++] : null),
  };
};

const policyQuery = () => {
  const chain = {
    select: () => chain,
    batchSize: () => chain,
    cursor: () => makeCursor(policies),
  };
  return chain;
};

const stubs = {
  "../../models/Policy": {
    find: policyQuery,
    deleteOne: async () => {
      callLog.push("policy:delete");
      return { deletedCount: 1 };
    },
  },
  "../../models/AuditLog": {
    create: async () => {
      callLog.push("audit:create");
    },
  },
  "../../models/NotificationDelivery": {
    deleteMany: async () => {
      callLog.push("notifications:delete");
    },
  },
  "../../models/CustomerVehicleHistory": {
    updateOne: async () => {
      callLog.push("history:upsert");
      if (archiveShouldFail) throw new Error("simulated archive failure");
      return { upsertedCount: 1 };
    },
  },
};

const originalLoad = Module._load;
Module._load = function patched(request) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) {
    return stubs[request];
  }
  return originalLoad.apply(this, arguments);
};

const { runPolicyRetention } = require("../utils/cron/policyRetentionCleaner");

Module._load = originalLoad;

(async () => {
  // --- 1. Happy path: archive is written BEFORE the delete ------------------
  callLog = [];
  archiveShouldFail = false;
  policies = [expiredLongAgo];

  const summary = await runPolicyRetention();

  assert.strictEqual(summary.deleted, 1, "the aged policy should be deleted");
  assert.strictEqual(summary.failed, 0);

  assert.ok(
    callLog.includes("history:upsert"),
    "the customer -> vehicle link must be archived",
  );
  assert.ok(
    callLog.indexOf("history:upsert") < callLog.indexOf("policy:delete"),
    "the archive MUST be written before the policy is deleted",
  );
  assert.ok(
    callLog.indexOf("audit:create") < callLog.indexOf("policy:delete"),
    "the audit entry must be written before the policy disappears",
  );
  assert.deepStrictEqual(callLog, [
    "history:upsert",
    "notifications:delete",
    "audit:create",
    "policy:delete",
  ]);

  // --- 2. Archive failure must ABORT the delete -----------------------------
  callLog = [];
  archiveShouldFail = true;
  policies = [expiredLongAgo];

  const failedSummary = await runPolicyRetention();

  assert.strictEqual(failedSummary.deleted, 0, "nothing may be deleted");
  assert.strictEqual(failedSummary.failed, 1, "the failure must be counted");
  assert.ok(
    !callLog.includes("policy:delete"),
    "if the archive write fails the policy must NOT be deleted",
  );

  // --- 3. Dry run changes nothing -------------------------------------------
  callLog = [];
  archiveShouldFail = false;
  policies = [expiredLongAgo];

  const dry = await runPolicyRetention({ dryRun: true });

  assert.strictEqual(dry.dryRun, true);
  assert.strictEqual(dry.deleted, 1, "dry run reports what would be deleted");
  assert.deepStrictEqual(callLog, [], "dry run must perform no writes at all");
  assert.strictEqual(dry.candidates.length, 1);
  assert.strictEqual(dry.candidates[0].policyNumber, "CUV-OLD-1");

  // --- 4. Second run over an empty set is safe ------------------------------
  callLog = [];
  policies = [];
  const second = await runPolicyRetention();
  assert.strictEqual(second.deleted, 0);
  assert.strictEqual(second.failed, 0);
  assert.deepStrictEqual(callLog, []);

  console.log(
    "Retention archive-order tests passed: history written before delete, failure aborts delete, dry run writes nothing, repeat run is safe.",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
