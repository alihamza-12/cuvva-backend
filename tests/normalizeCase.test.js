const assert = require("assert");
const {
  toUpperTrimmed,
  toRegistration,
  normalizeCaseFields,
} = require("../utils/normalizeCase");

// --- 1. Registration: uppercase + strip spaces/punctuation ------------------
assert.strictEqual(toRegistration("ab12 cde"), "AB12CDE");
assert.strictEqual(toRegistration("  bd55 smr  "), "BD55SMR");
assert.strictEqual(toRegistration("AB-12-CDE"), "AB12CDE");
assert.strictEqual(toRegistration("kv16wyz"), "KV16WYZ");

// --- 2. Plain uppercase fields keep internal spaces -------------------------
assert.strictEqual(toUpperTrimmed("sw1a 1aa"), "SW1A 1AA");
assert.strictEqual(toUpperTrimmed("  ab12 3cd "), "AB12 3CD");

// --- 3. Non-strings pass through untouched ----------------------------------
assert.strictEqual(toUpperTrimmed(undefined), undefined);
assert.strictEqual(toUpperTrimmed(null), null);
assert.strictEqual(toUpperTrimmed(42), 42);
assert.strictEqual(toRegistration(undefined), undefined);

// --- 4. Payload normalisation ----------------------------------------------
const payload = normalizeCaseFields({
  registration: "ab12 cde",
  vehicleIdentificationNumber: "wauzzz8v0ja000001",
  abiCode: "ab123",
  engineCode: "eng1",
  engineNumber: "en99",
  euroStatus: "euro6",
  wheelplan: "2 axle rigid body",
  drivingLicenceNumber: "smith901234ab9cd",
  policyNumber: "cuv-2026-0001",
  // must NOT be touched
  fullName: "Ali Hamza",
  make: "Vauxhall",
  model: "Astra SRI NAV",
  colour: "blue",
  city: "Lahore",
  email: "customer@example.com",
});

assert.strictEqual(payload.registration, "AB12CDE");
assert.strictEqual(payload.vehicleIdentificationNumber, "WAUZZZ8V0JA000001");
assert.strictEqual(payload.abiCode, "AB123");
assert.strictEqual(payload.engineCode, "ENG1");
assert.strictEqual(payload.engineNumber, "EN99");
assert.strictEqual(payload.euroStatus, "EURO6");
assert.strictEqual(payload.wheelplan, "2 AXLE RIGID BODY");
assert.strictEqual(payload.drivingLicenceNumber, "SMITH901234AB9CD");
assert.strictEqual(payload.policyNumber, "CUV-2026-0001");

// Prose and email must survive unchanged.
assert.strictEqual(payload.fullName, "Ali Hamza");
assert.strictEqual(payload.make, "Vauxhall");
assert.strictEqual(payload.model, "Astra SRI NAV");
assert.strictEqual(payload.colour, "blue");
assert.strictEqual(payload.city, "Lahore");
assert.strictEqual(
  payload.email,
  "customer@example.com",
  "email is stored lowercase and must never be uppercased",
);

// --- 5. Nested address.postcode --------------------------------------------
const withAddress = normalizeCaseFields({
  address: { line1: "12 High Street", city: "London", postcode: "sw1a 1aa" },
});
assert.strictEqual(withAddress.address.postcode, "SW1A 1AA");
assert.strictEqual(withAddress.address.line1, "12 High Street");
assert.strictEqual(withAddress.address.city, "London");

// --- 6. PATCH-safety: absent keys are not invented --------------------------
const partial = normalizeCaseFields({ colour: "red" });
assert.ok(!("registration" in partial));
assert.ok(!("postcode" in partial));
assert.strictEqual(partial.colour, "red");

// --- 7. Idempotent ----------------------------------------------------------
assert.deepStrictEqual(normalizeCaseFields(payload), payload);

console.log(
  "Uppercase normalisation tests passed: registration stripping, postcode, VIN, codes, prose untouched, email untouched, nested address, PATCH safety, idempotency.",
);
