const assert = require("assert");
const fs = require("fs");
const path = require("path");

/*
 * Guards for:
 *   1. country fixed to GB everywhere and never client-editable
 *   2. the main phone captured at customer creation, editable by customer+admin
 *   3. additional numbers kept separate so they cannot overwrite the main one
 *   4. the driving licence remaining visible on the customer profile
 */

const read = (relative) =>
  fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
const frontend = (relative) =>
  path.join(__dirname, "..", "..", "cuvva-frontend", "src", relative);

/* ---------------------------------------------------------------- *
 * 1. Country is GB and cannot be set by a client
 * ---------------------------------------------------------------- */
assert.ok(
  read("models/User.js").includes('country: { type: String, default: "GB" }'),
  "User.address.country must default to GB.",
);

const authSource = read("routes/auth.js");
assert.ok(
  authSource.includes('country: "GB"'),
  "Registration must hard-code the country to GB.",
);
assert.ok(
  !/country:\s*address\.country/.test(authSource),
  "Registration must not take the country from the request body.",
);

const customersSource = read("routes/customers.js");
assert.strictEqual(
  (customersSource.match(/nextAddress\.country = "GB";/g) || []).length,
  2,
  "Both the customer self-update and the admin update must force country to GB.",
);
assert.ok(
  !/for \(const field of \["line1", "line2", "city", "county", "country"\]/.test(
    customersSource,
  ),
  "Country must not be copied from the client payload in address updates.",
);

/* ---------------------------------------------------------------- *
 * 2. Phone is stored at creation and is editable afterwards
 * ---------------------------------------------------------------- */
assert.ok(
  /phone:\s*\n?\s*role === "Customer"/.test(authSource),
  "Registration must persist the customer's phone number.",
);
assert.ok(
  customersSource.includes("customer.phone = trimmedPhone"),
  "A customer must be able to update their own phone.",
);
assert.ok(
  customersSource.includes("targetUser.phone = trimmedPhone"),
  "An admin must be able to update a customer's phone.",
);

/* Phone flows into the certificate / in-app policy document. */
assert.ok(
  read("services/pdf/generatePolicyCertificate.js").includes(
    'phone: customer.phone || "N/A"',
  ),
  "The policy document must include the customer's phone.",
);

/* ---------------------------------------------------------------- *
 * 3. Additional numbers never overwrite the main one
 * ---------------------------------------------------------------- */
assert.ok(
  read("models/User.js").includes("additionalPhones"),
  "User must store additionalPhones separately from the main phone.",
);
assert.ok(
  customersSource.includes("customer.additionalPhones = ["),
  "Adding an extra number must append to additionalPhones.",
);
assert.ok(
  customersSource.includes("This is already your main mobile number"),
  "Adding an extra number must reject the main number.",
);
assert.ok(
  customersSource.includes("targetUser.additionalPhones = cleaned"),
  "Admins must be able to edit the additional numbers list.",
);
assert.ok(
  /\.select\(\s*\n?\s*"[^"]*additionalPhones[^"]*"/.test(customersSource),
  "GET /me must return additionalPhones so the app can list them.",
);

/* The customer 'add another number' screen must NOT hit the main-phone route. */
const addPage = frontend("components/customer/AddMobileNumberPage.jsx");
if (fs.existsSync(addPage)) {
  const page = fs.readFileSync(addPage, "utf8");
  assert.ok(
    page.includes("addAdditionalPhone"),
    "Add-another-number must use the additional-phone mutation.",
  );
  assert.ok(
    !page.includes("updatePhoneNumber("),
    "Add-another-number must not overwrite the main phone.",
  );
}

/* ---------------------------------------------------------------- *
 * 4. Licence stays visible, and the admin modals expose phone fields
 * ---------------------------------------------------------------- */
assert.ok(
  /\.select\(\s*\n?\s*"[^"]*drivingLicenceNumber[^"]*"/.test(customersSource),
  "GET /me must return drivingLicenceNumber so the app can show it.",
);

const identityPage = frontend("components/customer/MyIdentityPage.jsx");
if (fs.existsSync(identityPage)) {
  assert.ok(
    fs.readFileSync(identityPage, "utf8").includes("drivingLicenceNumber"),
    "The customer identity screen must display the driving licence.",
  );
}

for (const relative of [
  "components/super-admin/AccountManagement.jsx",
  "components/super-admin/OwnCustomersManagement.jsx",
]) {
  const modalPath = frontend(relative);
  if (!fs.existsSync(modalPath)) continue;
  const modal = fs.readFileSync(modalPath, "utf8");
  assert.ok(
    modal.includes("payload.phone") && modal.includes("setEditPhone"),
    `${relative}: the edit modal must allow editing the phone.`,
  );
  assert.ok(
    modal.includes("payload.additionalPhones"),
    `${relative}: the edit modal must allow editing additional numbers.`,
  );
}

console.log(
  "Phone & country tests passed: GB fixed and non-editable, phone saved at creation and editable by customer + admin, additional numbers kept separate, licence visible.",
);
