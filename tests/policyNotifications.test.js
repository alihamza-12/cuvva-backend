const assert = require("assert");
const Module = require("module");
const { policyDateTimeToInstant } = require("../utils/policyDateTime");

const deliveries = new Map();
let policies = [];
let sendCount = 0;
let failNextSend = false;

const keyFor = (policyId, type) => `${policyId}:${type}`;
const attachSave = (record) => {
  record.save = async () => {
    record.updatedAt = new Date();
    deliveries.set(keyFor(record.policyId, record.type), record);
    return record;
  };
  return record;
};

const NotificationDelivery = {
  async findOneAndUpdate(filter, update) {
    const record = deliveries.get(keyFor(filter.policyId, filter.type));
    if (!record || record.attemptCount >= filter.attemptCount.$lt) return null;
    const retryCutoff = filter.$or[0].updatedAt.$lte;
    const staleCutoff = filter.$or[1].claimedAt.$lte;
    const retryable =
      (record.status === "failed" && record.updatedAt <= retryCutoff) ||
      (record.status === "sending" && record.claimedAt <= staleCutoff);
    if (!retryable) return null;
    Object.assign(record, update.$set);
    record.attemptCount += update.$inc.attemptCount;
    record.updatedAt = new Date(update.$set.claimedAt);
    return record;
  },
  async create(input) {
    const key = keyFor(input.policyId, input.type);
    if (deliveries.has(key)) {
      const error = new Error("duplicate");
      error.code = 11000;
      throw error;
    }
    const record = attachSave({ ...input, updatedAt: new Date(input.claimedAt) });
    deliveries.set(key, record);
    return record;
  },
};

const Policy = {
  find() {
    const query = {
      populate() { return query; },
      then(resolve, reject) { return Promise.resolve(policies).then(resolve, reject); },
    };
    return query;
  },
};

const sendPolicyNotification = async () => {
  sendCount += 1;
  if (failNextSend) {
    failNextSend = false;
    throw new Error("simulated provider failure with secret-like details");
  }
  return { id: `message-${sendCount}`, recipients: 1 };
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (parent?.filename?.endsWith("policyNotificationProcessor.js")) {
    if (request === "../models/NotificationDelivery") return NotificationDelivery;
    if (request === "../models/Policy") return Policy;
    if (request === "./oneSignalNotificationService") return { sendPolicyNotification };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { processPolicyNotifications } = require("../services/policyNotificationProcessor");
Module._load = originalLoad;

const policy = (id, preferences = {}) => ({
  _id: id,
  status: "Active",
  startDate: new Date("2026-07-15T00:00:00.000Z"),
  startTime: "12:00",
  endDate: new Date("2026-07-15T00:00:00.000Z"),
  endTime: "13:00",
  customerId: { _id: `customer-${id}`, role: "Customer", status: "Active", notificationPreferences: preferences },
  vehicleId: { _id: `vehicle-${id}`, registration: "AB12 CDE" },
});

(async () => {
  process.env.ONESIGNAL_APP_ID = "test-app";
  process.env.ONESIGNAL_REST_API_KEY = "test-key";

  assert.equal(policyDateTimeToInstant("2026-01-15", "12:00").toISOString(), "2026-01-15T12:00:00.000Z");
  assert.equal(policyDateTimeToInstant("2026-07-15", "12:00").toISOString(), "2026-07-15T11:00:00.000Z");
  assert.equal(policyDateTimeToInstant("2026-08-28", "00:15").toISOString(), "2026-08-27T23:15:00.000Z");
  assert.equal(policyDateTimeToInstant("2026-03-29", "01:30"), null);

  policies = [policy("one")];
  const now = new Date("2026-07-15T11:01:00.000Z");
  await processPolicyNotifications(now);
  await processPolicyNotifications(now);
  assert.equal(sendCount, 1, "duplicate worker runs must only send once");

  policies = [policy("disabled", { policyActive: false })];
  await processPolicyNotifications(now);
  assert.equal(sendCount, 1, "disabled preference must suppress provider delivery");

  policies = [policy("retry")];
  failNextSend = true;
  await processPolicyNotifications(now);
  assert.equal(deliveries.get("retry:ACTIVE").status, "failed");
  deliveries.get("retry:ACTIVE").updatedAt = now;
  await processPolicyNotifications(new Date(now.getTime() + 61_000));
  assert.equal(deliveries.get("retry:ACTIVE").status, "sent");
  assert.equal(deliveries.get("retry:ACTIVE").attemptCount, 2);

  console.log("Policy notification tests passed: timezone, midnight, DST gap, idempotency, preferences, and retry.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


