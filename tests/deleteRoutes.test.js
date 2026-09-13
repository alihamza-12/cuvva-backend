const assert = require("assert");
const fs = require("fs");
const path = require("path");

/*
 * Guards for the manual delete endpoints.
 *
 * The first check exists because of a real production bug: routes/policies.js
 * called getPolicyWindow() without importing it. `node --check` passes on that
 * (it is a runtime ReferenceError, not a syntax error), so the route only blew
 * up when an admin actually pressed Confirm Delete, surfacing as
 * "Server error while deleting the policy."
 */

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const policiesSource = read("routes/policies.js");
const managementSource = read("routes/management.js");

/* ------------------------------------------------------------------ *
 * 1. Every helper used must actually be imported (the bug that shipped)
 * ------------------------------------------------------------------ */
const HELPERS = [
  "getPolicyWindow",
  "computePolicyStatus",
  "withDerivedStatus",
  "withDerivedStatuses",
];

for (const helper of HELPERS) {
  const isUsed = new RegExp(`${helper}\\s*\\(`).test(policiesSource);
  if (!isUsed) continue;

  const importBlock = policiesSource.slice(0, policiesSource.indexOf("router."));
  assert.ok(
    new RegExp(`\\b${helper}\\b`).test(importBlock),
    `routes/policies.js uses ${helper}() but never imports it — this throws a ReferenceError at runtime and returns a 500 to the dashboard.`,
  );
}

/* Models referenced by the delete routes must be required too. */
for (const model of [
  "AuditLog",
  "NotificationDelivery",
  "CustomerVehicleHistory",
]) {
  assert.ok(
    policiesSource.includes(`require("../models/${model}")`),
    `routes/policies.js must require ${model}.`,
  );
}

for (const model of [
  "Policy",
  "AuditLog",
  "NotificationDelivery",
  "CustomerVehicleHistory",
]) {
  assert.ok(
    managementSource.includes(`require("../models/${model}")`),
    `routes/management.js must require ${model}.`,
  );
}

/* ------------------------------------------------------------------ *
 * 2. Both delete routes exist and allow Super Admin + Sub Admin
 * ------------------------------------------------------------------ */
const policyDeleteBlock = policiesSource.slice(
  policiesSource.indexOf('router.delete(\n  "/:id"'),
);
assert.ok(
  policyDeleteBlock.includes('authorizeRoles("Super Admin", "Sub Admin")'),
  "DELETE /api/policies/:id must allow Super Admin and Sub Admin.",
);

const customerDeleteBlock = managementSource.slice(
  managementSource.indexOf('router.delete(\n  "/customers/:id"'),
);
assert.ok(
  customerDeleteBlock.includes('authorizeRoles("Super Admin", "Sub Admin")'),
  "DELETE /api/management/customers/:id must allow Super Admin and Sub Admin.",
);

/* ------------------------------------------------------------------ *
 * 3. Sub Admin scoping — they may only delete their OWN records
 * ------------------------------------------------------------------ */
assert.ok(
  policyDeleteBlock.includes('req.user.role === "Sub Admin"') &&
    policyDeleteBlock.includes("policy.createdBy"),
  "The policy delete route must restrict a Sub Admin to policies they created.",
);
assert.ok(
  customerDeleteBlock.includes('req.user.role === "Sub Admin"') &&
    customerDeleteBlock.includes("customer.createdBy"),
  "The customer delete route must restrict a Sub Admin to customers they created.",
);

/* Only customer accounts may be removed through the management endpoint. */
assert.ok(
  customerDeleteBlock.includes('customer.role !== "Customer"'),
  "The customer delete route must refuse to delete admin accounts.",
);

/* ------------------------------------------------------------------ *
 * 4. Archive-before-delete ordering is preserved
 * ------------------------------------------------------------------ */
const archiveAt = policyDeleteBlock.indexOf("CustomerVehicleHistory.updateOne");
const deleteAt = policyDeleteBlock.indexOf("Policy.deleteOne");
assert.ok(archiveAt > -1, "The policy delete route must archive the vehicle link.");
assert.ok(
  archiveAt < deleteAt,
  "The customer -> vehicle link MUST be archived before the policy is deleted.",
);

const customerArchiveAt = customerDeleteBlock.indexOf(
  "CustomerVehicleHistory.updateOne",
);
const customerDeleteAt = customerDeleteBlock.indexOf("User.deleteOne");
assert.ok(
  customerArchiveAt > -1 && customerArchiveAt < customerDeleteAt,
  "Customer deletion must archive vehicle links before removing the customer.",
);

/* An audit entry is written before the record disappears. */
assert.ok(
  policyDeleteBlock.indexOf("AuditLog.create") < deleteAt,
  "An audit entry must be written before the policy row is removed.",
);

/* ------------------------------------------------------------------ *
 * 5. Sanity: the sources parse and load
 * ------------------------------------------------------------------ */
assert.doesNotThrow(
  () => require("../routes/policies"),
  "routes/policies.js must load without throwing.",
);
assert.doesNotThrow(
  () => require("../routes/management"),
  "routes/management.js must load without throwing.",
);

console.log(
  "Delete route tests passed: all helpers imported (no ReferenceError), both routes role-guarded, Sub Admin scoped to own records, admin accounts protected, archive-before-delete ordering intact.",
);
