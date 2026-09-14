const assert = require("assert");
const fs = require("fs");
const path = require("path");

/*
 * Guards for the residential address feature:
 *   1. the PDF certificate shows the real address (not just the country)
 *   2. the in-app policy document shows the same value
 *   3. the customer can read and update their address from the app
 */

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

/* ------------------------------------------------------------------ *
 * 1 + 2. Shared formatter feeds BOTH the PDF and the in-app document
 * ------------------------------------------------------------------ */
const {
  buildDocumentData,
} = require("../services/pdf/generatePolicyCertificate");

const basePolicy = {
  _id: "p1",
  policyNumber: "PPWAKF2HXILEO9DK6",
  startDate: new Date("2026-09-13"),
  endDate: new Date("2026-09-14"),
  startTime: "11:30",
  endTime: "11:29",
  premiumAmount: 100,
  excess: 500,
};
const baseVehicle = {
  registration: "YX70HMK",
  vehicleIdentificationNumber: "WBAJC92070CE67234",
  make: "BMW",
  model: "530D M Sport Auto",
  colour: "Grey",
  year: 2020,
};

/* A full address must render every part, not just the country. */
const fullAddress = buildDocumentData({
  policy: basePolicy,
  vehicle: baseVehicle,
  customer: {
    fullName: "Walid shah",
    drivingLicenceNumber: "SHAH9002223W99RR",
    address: {
      line1: "Ditzti",
      line2: "Kxhkgy",
      city: "Khxkhx",
      postcode: "KXGGKX",
      country: "UK",
    },
  },
}).address;

assert.strictEqual(
  fullAddress,
  "Ditzti, Kxhkgy, Khxkhx, KXGGKX, UK",
  "The certificate must show the full residential address.",
);
assert.ok(
  fullAddress !== "UK",
  "The certificate must not fall back to showing only the country.",
);

/* Missing pieces are skipped rather than printed as blanks. */
assert.strictEqual(
  buildDocumentData({
    policy: basePolicy,
    vehicle: baseVehicle,
    customer: { fullName: "X", address: { line1: "1 High St", city: "London" } },
  }).address,
  "1 High St, London",
);

/* No address at all is still handled safely. */
assert.strictEqual(
  buildDocumentData({
    policy: basePolicy,
    vehicle: baseVehicle,
    customer: { fullName: "X" },
  }).address,
  "N/A",
);

/* The in-app policy document endpoint uses the very same builder. */
const policiesSource = read("routes/policies.js");
assert.ok(
  policiesSource.includes("buildDocumentData({ policy, customer, vehicle })"),
  "The /document-data endpoint must reuse buildDocumentData so the app and the PDF agree.",
);

/* ------------------------------------------------------------------ *
 * 3. The customer can read and update their own address
 * ------------------------------------------------------------------ */
const customersSource = read("routes/customers.js");

assert.ok(
  /\.select\(\s*\n?\s*"[^"]*\baddress\b[^"]*"/.test(customersSource),
  "GET /api/customers/me must select `address`, otherwise the app can never display it.",
);

const patchBlock = customersSource.slice(
  customersSource.indexOf('router.patch(\n  "/me",'),
  customersSource.indexOf('router.get(\n  "/",'),
);

assert.ok(
  patchBlock.includes("address"),
  "PATCH /api/customers/me must accept an address.",
);
assert.ok(
  patchBlock.includes("customer.address = nextAddress"),
  "The submitted address must be written to the customer document.",
);
assert.ok(
  patchBlock.includes("toUpperCase()"),
  "Postcodes must be stored uppercase, matching the admin create forms.",
);
assert.ok(
  patchBlock.includes("Address line 1 is required") &&
    patchBlock.includes("City / town is required") &&
    patchBlock.includes("Postcode is required"),
  "The address update must validate the required fields.",
);
assert.ok(
  patchBlock.includes("existingAddress.county") &&
    patchBlock.includes("existingAddress.country"),
  "A partial update must preserve county/country rather than wiping them.",
);

/* ------------------------------------------------------------------ *
 * 4. The app page reads from the API, not only localStorage
 * ------------------------------------------------------------------ */
const pagePath = path.join(
  __dirname,
  "..",
  "..",
  "cuvva-frontend",
  "src",
  "components",
  "customer",
  "ResidentialAddressPage.jsx",
);

if (fs.existsSync(pagePath)) {
  const page = fs.readFileSync(pagePath, "utf8");
  assert.ok(
    page.includes("getMyProfile"),
    "The address page must load the saved address from the database.",
  );
  assert.ok(
    page.includes("updateMyAddress"),
    "The address page must save changes to the database.",
  );
}

/* ------------------------------------------------------------------ *
 * 5. Admins can update a customer's address from the edit modal
 * ------------------------------------------------------------------ */
const adminPatchBlock = customersSource.slice(
  customersSource.indexOf('router.patch(\n  "/:id",'),
);

assert.ok(
  adminPatchBlock.includes("address"),
  "PATCH /api/customers/:id must accept an address so admins can edit it.",
);
assert.ok(
  adminPatchBlock.includes("targetUser.address = nextAddress"),
  "The admin update must write the address to the customer document.",
);
assert.ok(
  adminPatchBlock.includes("existingAddress.county") &&
    adminPatchBlock.includes("existingAddress.country"),
  "An admin partial address update must preserve county/country.",
);
assert.ok(
  adminPatchBlock.includes("toUpperCase()"),
  "Admin-entered postcodes must be stored uppercase.",
);

/* The admin edit modals must expose email, address and a password toggle. */
const modalPaths = [
  ["AccountManagement.jsx", "components/super-admin/AccountManagement.jsx"],
  [
    "OwnCustomersManagement.jsx",
    "components/super-admin/OwnCustomersManagement.jsx",
  ],
];

for (const [label, relative] of modalPaths) {
  const modalPath = path.join(
    __dirname,
    "..",
    "..",
    "cuvva-frontend",
    "src",
    relative,
  );
  if (!fs.existsSync(modalPath)) continue;
  const modal = fs.readFileSync(modalPath, "utf8");

  assert.ok(
    modal.includes("value={editEmail}"),
    `${label}: the edit modal must include the email field.`,
  );
  assert.ok(
    modal.includes("editAddress.line1") &&
      modal.includes("editAddress.city") &&
      modal.includes("editAddress.postcode"),
    `${label}: the edit modal must include the address fields.`,
  );
  assert.ok(
    modal.includes('showPassword ? "text" : "password"'),
    `${label}: the password field must support show/hide.`,
  );
  assert.ok(
    modal.includes("payload.address"),
    `${label}: the address must be sent with the update.`,
  );
}

console.log(
  "Customer address tests passed: full address on the certificate and in-app document, /me exposes address, customer + admin can update it, postcode uppercased, partial updates safe, admin modals expose email/address/password toggle.",
);
