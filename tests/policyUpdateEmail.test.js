const assert = require("assert");
const fs = require("fs");
const path = require("path");

/*
 * Guards for the "re-send the policy email when a policy is edited" feature.
 *
 * Kept as a source-level check (like tests/deleteRoutes.test.js) so it runs in
 * the repo's dependency-free `npm test` without needing a live MongoDB or SMTP
 * server. It protects the properties that matter and the ones most likely to be
 * broken by a later refactor.
 */

const source = fs.readFileSync(
  path.join(__dirname, "..", "routes", "policies.js"),
  "utf8",
);

/* The PUT handler, isolated from the POST (create) handler. */
const putStart = source.indexOf('router.put(\n  "/:id"');
const putEnd = source.indexOf("router.delete(", putStart);
assert.ok(putStart > -1, "PUT /api/policies/:id must exist.");
let putBlock = source.slice(putStart, putEnd);

/*
 * Strip comments before asserting. Otherwise a doc comment that merely MENTIONS
 * sendPolicyEmail() would satisfy the checks below even if the real call had
 * been deleted — which would make this whole test worthless.
 */
const stripComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

putBlock = stripComments(putBlock);

/* ------------------------------------------------------------------ *
 * 1. The update path actually sends the email, with a fresh PDF
 * ------------------------------------------------------------------ */
assert.ok(
  putBlock.includes("sendPolicyEmail("),
  "Editing a policy must re-send the policy email to the customer.",
);
assert.ok(
  putBlock.includes("generatePolicyCertificatePdf("),
  "The updated email must attach a newly generated certificate PDF.",
);

/* ------------------------------------------------------------------ *
 * 2. Every helper used is imported (the ReferenceError class of bug)
 * ------------------------------------------------------------------ */
const importBlock = source.slice(0, source.indexOf("router."));
for (const helper of [
  "sendPolicyEmail",
  "generatePolicyCertificatePdf",
  "getPolicyWindow",
  "formatEmailPolicyDateTime",
  "formatPolicyDuration",
  "User",
  "Vehicle",
]) {
  if (!new RegExp(`\\b${helper}\\b`).test(putBlock)) continue;
  assert.ok(
    new RegExp(`\\b${helper}\\b`).test(importBlock),
    `routes/policies.js uses ${helper} in the update handler but never imports/defines it — this throws a ReferenceError at runtime.`,
  );
}

/* ------------------------------------------------------------------ *
 * 3. The email is built from the SAVED policy, not the request body
 * ------------------------------------------------------------------ */
assert.ok(
  putBlock.includes("policy.premiumAmount") &&
    putBlock.includes("policy.startTime") &&
    putBlock.includes("policy.endTime"),
  "The updated email must read values from the saved policy so it reflects the new data.",
);

/* The mail must be sent only after the policy has been persisted. */
assert.ok(
  putBlock.indexOf("await policy.save()") <
    putBlock.indexOf("sendPolicyEmail("),
  "The email must be sent AFTER the policy is saved, otherwise it could describe values that were never stored.",
);

/* ------------------------------------------------------------------ *
 * 4. A mail failure must never fail the update itself
 * ------------------------------------------------------------------ */
const mailCallIndex = putBlock.indexOf("sendPolicyEmail(");
const afterMailCall = putBlock.slice(mailCallIndex);
assert.ok(
  afterMailCall.includes(".catch("),
  "sendPolicyEmail must be fire-and-forget with a .catch(), so SMTP problems cannot fail a successful update.",
);
assert.ok(
  putBlock.includes("Failed to generate updated policy certificate") ||
    putBlock.includes("try {"),
  "PDF generation in the update path must be wrapped in try/catch.",
);

/* ------------------------------------------------------------------ *
 * 5. Nothing about the mail transport was changed
 * ------------------------------------------------------------------ */
const mailSource = fs.readFileSync(
  path.join(__dirname, "..", "utils", "sendEmail.js"),
  "utf8",
);
assert.ok(
  mailSource.includes("Cuvva <auto@cuvvapolicies.com>"),
  "The sender address must remain unchanged.",
);
assert.ok(
  mailSource.includes("subject: `Your Cuvva policy (${policyData.policyNumber})`"),
  "The subject line must remain unchanged.",
);
assert.ok(
  mailSource.includes("module.exports = { sendPolicyEmail, buildPolicyEmailHtml }"),
  "sendEmail.js exports must remain unchanged.",
);

/* Creation must still send its email too. */
const postBlock = source.slice(
  source.indexOf('router.post(\n  "/",'),
  putStart,
);
assert.ok(
  postBlock.includes("sendPolicyEmail("),
  "Policy creation must still send its original email.",
);

console.log(
  "Policy update email tests passed: re-sends on edit with a fresh PDF, uses saved values, sent after save, failures cannot break the update, mail transport untouched, creation email intact.",
);
