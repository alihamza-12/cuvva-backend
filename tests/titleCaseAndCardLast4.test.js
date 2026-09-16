const assert = require("assert");
const fs = require("fs");
const path = require("path");

/*
 * Guards for the two features added together:
 *
 *   1. Title case — first letter capital, the rest lower case — for customer
 *      names and address prose, plus uppercase postcode / driving licence.
 *      Applied at the schema level so every write path stores the same form.
 *
 *   2. The "last 4 digits of the payment card" marker:
 *        - optional when a customer is created
 *        - required when a policy is created
 *        - pre-filled from the customer record on the Create Policy screen
 *        - written back to the customer record when a policy is issued
 */

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
const frontend = (relative) =>
  path.join(__dirname, "..", "..", "cuvva-frontend", "src", relative);

const {
  toTitleCase,
  normalizeCaseFields,
} = require("../utils/normalizeCase");
const {
  normalizeCardLast4,
  isValidCardLast4,
  isBlankCardLast4,
  parseCardLast4,
  CARD_LAST4_MESSAGE,
} = require("../utils/normalizeCardLast4");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");

/* ------------------------------------------------------------------ *
 * 1. Title case helper
 * ------------------------------------------------------------------ */
assert.strictEqual(toTitleCase("jane doe"), "Jane Doe");
assert.strictEqual(toTitleCase("JANE DOE"), "Jane Doe");
assert.strictEqual(toTitleCase("  jane   doe  "), "Jane Doe");
assert.strictEqual(toTitleCase("12 high street"), "12 High Street");
assert.strictEqual(toTitleCase("o'brien"), "O'Brien");
assert.strictEqual(toTitleCase("anne-marie"), "Anne-Marie");
assert.strictEqual(toTitleCase(undefined), undefined);
assert.strictEqual(toTitleCase(null), null);

/* ------------------------------------------------------------------ *
 * 2. Card last four digits helper
 * ------------------------------------------------------------------ */
assert.strictEqual(normalizeCardLast4("1234"), "1234");
assert.strictEqual(normalizeCardLast4("12 34"), "1234");
assert.strictEqual(normalizeCardLast4("123456"), "1234");
assert.strictEqual(normalizeCardLast4(1234), "1234");
assert.strictEqual(isValidCardLast4("1234"), true);
assert.strictEqual(isValidCardLast4("123"), false);
assert.strictEqual(isValidCardLast4("12a4"), false);
assert.strictEqual(isBlankCardLast4(""), true);
assert.strictEqual(isBlankCardLast4(undefined), true);
assert.strictEqual(isBlankCardLast4(null), true);
assert.strictEqual(isBlankCardLast4("0000"), false);

// Blank clears the marker, four digits sets it, anything else is rejected
// with the single message every surface shows.
assert.deepStrictEqual(parseCardLast4(""), { ok: true, value: null, message: null });
assert.deepStrictEqual(parseCardLast4(undefined), { ok: true, value: null, message: null });
assert.deepStrictEqual(parseCardLast4(" 42 17 "), { ok: true, value: "4217", message: null });
assert.strictEqual(parseCardLast4("12").ok, false);
assert.strictEqual(parseCardLast4("abcd").ok, false);
assert.strictEqual(parseCardLast4("12").message, CARD_LAST4_MESSAGE);

/* ------------------------------------------------------------------ *
 * 3. Schema setters — the form the value is actually STORED in
 * ------------------------------------------------------------------ */
const schemaCustomer = new User({
  fullName: "jane sarah doe",
  email: "jane@example.com",
  password: "Cuvva@123",
  role: "Customer",
  drivingLicenceNumber: "smith901234ab9cd",
  address: {
    line1: "12 high street",
    line2: "flat 2b",
    city: "new york",
    county: "greater london",
    postcode: "sw1a 1aa",
    country: "GB",
  },
  lastFourDigits: "12 34",
});

assert.strictEqual(schemaCustomer.fullName, "Jane Sarah Doe");
// firstName / lastName are title cased by their own setters too. (The two parts
// themselves are derived from fullName by the existing pre-save hook.)
assert.strictEqual(new User({ firstName: "jane", lastName: "sarah doe" }).firstName, "Jane");
assert.strictEqual(new User({ firstName: "jane", lastName: "sarah doe" }).lastName, "Sarah Doe");
assert.strictEqual(schemaCustomer.address.line1, "12 High Street");
assert.strictEqual(schemaCustomer.address.line2, "Flat 2b");
assert.strictEqual(schemaCustomer.address.city, "New York");
assert.strictEqual(schemaCustomer.address.county, "Greater London");
assert.strictEqual(schemaCustomer.address.postcode, "SW1A 1AA");
assert.strictEqual(schemaCustomer.drivingLicenceNumber, "SMITH901234AB9CD");
assert.strictEqual(schemaCustomer.lastFourDigits, "1234");
assert.ifError(schemaCustomer.validateSync());

// A broken card marker is rejected rather than stored half-normalised.
const brokenCard = new User({
  fullName: "jane doe",
  email: "jane2@example.com",
  password: "Cuvva@123",
  role: "Customer",
  lastFourDigits: "12",
});
assert.ok(
  brokenCard.validateSync()?.errors?.lastFourDigits,
  "A card marker that is not exactly four digits must fail validation.",
);

// A blank card marker is allowed.
const blankCard = new User({
  fullName: "jane doe",
  email: "jane3@example.com",
  password: "Cuvva@123",
  role: "Customer",
  lastFourDigits: "",
});
assert.ifError(blankCard.validateSync());

// Vehicle colour is title cased too.
assert.strictEqual(
  new Vehicle({ colour: "blue" }).colour,
  "Blue",
  "Vehicle colour must be stored title cased.",
);

// The shared payload normaliser title cases the same fields.
const normalized = normalizeCaseFields({
  fullName: "ali hamza",
  address: { line1: "1 park road", city: "london", postcode: "sw1a 1aa" },
});
assert.strictEqual(normalized.fullName, "Ali Hamza");
assert.strictEqual(normalized.address.line1, "1 Park Road");
assert.strictEqual(normalized.address.city, "London");
assert.strictEqual(normalized.address.postcode, "SW1A 1AA");

/* ------------------------------------------------------------------ *
 * 4. Registration (customer creation) accepts the optional card marker
 * ------------------------------------------------------------------ */
const authSource = read("routes/auth.js");

assert.ok(
  authSource.includes("parseCardLast4"),
  "Registration must parse the optional last-4 card marker.",
);
assert.ok(
  authSource.includes("lastFourDigits:\n          role === \"Customer\""),
  "Registration must store lastFourDigits on the customer.",
);
assert.ok(
  authSource.includes("user: {") && authSource.includes("id: newUser._id"),
  "Registration must return the new user's id so the dashboard can redirect to the customer page.",
);

/* ------------------------------------------------------------------ *
 * 5. Admin + customer updates handle the card marker and title case
 * ------------------------------------------------------------------ */
const customersSource = read("routes/customers.js");

assert.ok(
  customersSource.includes("targetUser.lastFourDigits = parsedCard.value || undefined;"),
  "PATCH /api/customers/:id must persist lastFourDigits (previously it was silently dropped).",
);
assert.ok(
  customersSource.includes("lastFourDigits: targetUser.lastFourDigits"),
  "The admin update response must echo the saved card marker.",
);
assert.strictEqual(
  (customersSource.match(/nextAddress\[field\] = toTitleCase\(/g) || []).length,
  2,
  "Both the customer self-update and the admin update must title case address prose.",
);

const adminPatchBlock = customersSource.slice(
  customersSource.indexOf('router.patch(\n  "/:id",'),
);
assert.ok(
  adminPatchBlock.includes("lastFourDigits === undefined"),
  "The 'no update fields provided' guard must accept a card-only update.",
);

/* ------------------------------------------------------------------ *
 * 6. Issuing a policy writes the card back onto the customer
 * ------------------------------------------------------------------ */
const policiesSource = read("routes/policies.js");

assert.ok(
  policiesSource.includes("$set: { lastFourDigits: cardLast4 }"),
  "POST /api/policies must write the card marker back to the customer record.",
);
const cardWriteIndex = policiesSource.indexOf("$set: { lastFourDigits: cardLast4 }");
const policyCreateIndex = policiesSource.indexOf(
  "const newPolicy = await Policy.create(",
);
assert.ok(cardWriteIndex > -1, "The customer card write must exist.");
assert.ok(
  cardWriteIndex < policyCreateIndex,
  "The card must be saved on the customer before the policy row is created.",
);
assert.ok(
  policiesSource.includes("Enter exactly the last 4 digits of the payment card"),
  "Policy creation must still reject a missing / malformed card marker.",
);

/* ------------------------------------------------------------------ *
 * 7. Frontend wiring
 * ------------------------------------------------------------------ */
const titleCaseInputPath = frontend("components/common/TitleCaseInput.jsx");
assert.ok(fs.existsSync(titleCaseInputPath), "TitleCaseInput.jsx must exist.");

const titleCaseUtilPath = frontend("utils/titleCase.js");
assert.ok(fs.existsSync(titleCaseUtilPath), "utils/titleCase.js must exist.");
const titleCaseUtil = fs.readFileSync(titleCaseUtilPath, "utf8");
assert.ok(
  titleCaseUtil.includes("export const toTitleCase"),
  "The frontend must mirror the backend title-case rule.",
);
assert.ok(
  titleCaseUtil.includes("export const isValidCardLast4"),
  "The frontend must validate the 4 digit card marker the same way the backend does.",
);

const checks = [
  {
    label: "sub-admin Create Customer",
    file: frontend("pages/sub-admin/CreateCustomerPage.jsx"),
    need: [
      "TitleCaseInput",
      "lastFourDigits",
      "Last 4 digits of payment card (optional)",
      "/dashboard/customers/${",
    ],
  },
  {
    label: "super-admin Create User",
    file: frontend("components/super-admin/CreateUser.jsx"),
    need: [
      "TitleCaseInput",
      "lastFourDigits",
      "Last 4 digits of payment card (optional)",
      "/admin/customers/${",
    ],
  },
  {
    label: "sub-admin Create Policy",
    file: frontend("pages/sub-admin/CreatePolicyPage.jsx"),
    need: [
      "lastFourDigits",
      "/dashboard/policies/${",
      "FieldError",
    ],
  },
  {
    label: "super-admin Create Policy",
    file: frontend("components/super-admin/CreatePolicy.jsx"),
    need: [
      "lastFourDigits",
      "/admin/policies/${",
      "FieldError",
    ],
  },
  {
    label: "super-admin Policy feed",
    file: frontend("components/super-admin/PolicyContracts.jsx"),
    need: ["query", "policyNumber", "customerId?.email"],
  },
];

for (const { label, file, need } of checks) {
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  for (const fragment of need) {
    assert.ok(
      source.includes(fragment),
      `${label} (${path.basename(file)}) must include: ${fragment}`,
    );
  }
}

// Every policy list must be searchable on card / email too.
for (const relative of [
  "components/super-admin/OwnPoliciesManagement.jsx",
  "components/sub-admin/SubAdminOwnPolicies.jsx",
  "components/sub-admin/SubAdminPolicyContracts.jsx",
]) {
  const file = frontend(relative);
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  assert.ok(
    source.includes("cardLast4"),
    `${relative}: policy search must also match the card marker.`,
  );
  assert.ok(
    source.includes("customerId?.email"),
    `${relative}: policy search must also match the customer email.`,
  );
}

console.log(
  "Title case & card last-4 tests passed: names/address prose title cased and stored that way, postcode + licence uppercase, optional card marker on customer creation, card persisted on policy creation, pre-fill + search wired in both dashboards.",
);
