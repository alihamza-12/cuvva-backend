/*
 * Case normalisation helpers.
 *
 * Mongoose's `uppercase: true` schema option only runs on document setters, so
 * it does NOT apply to `findOneAndUpdate` / `updateOne` style queries. These
 * helpers let a route normalise an incoming body explicitly before writing, so
 * the value stored in MongoDB is always in the canonical form regardless of
 * which write path is used.
 *
 * Three rules live here:
 *
 *   1. Codes and identifiers are UPPERCASED
 *      (driving licence, postcode, VIN, policy number, engine/ABI codes).
 *
 *   2. Human-readable prose is TITLE CASED — first letter capital, the rest
 *      lower case ("jane doe" -> "Jane Doe", "12 high street" ->
 *      "12 High Street"). Hyphenated and apostrophed names are handled
 *      ("anne-marie" -> "Anne-Marie", "o'brien" -> "O'Brien").
 *
 *   3. `email` (deliberately stored lowercase) and catalog values that must
 *      keep their original casing — `make`, `model` and other DVLA supplied
 *      strings such as "Astra SRI NAV" / "BMW" — are never touched.
 */

/** Fields that are plain uppercase codes. */
const UPPERCASE_FIELDS = [
  "drivingLicenceNumber",
  "vehicleIdentificationNumber",
  "abiCode",
  "engineCode",
  "engineNumber",
  "euroStatus",
  "wheelplan",
  "postcode",
  "policyNumber",
];

/**
 * Fields that are uppercased AND stripped of every non-alphanumeric character.
 * Mirrors `cleanRegistration()` in routes/vehicles.js.
 */
const REGISTRATION_FIELDS = ["registration"];

/**
 * Free-text prose fields that are title cased.
 *
 * Deliberately NOT included: `make` / `model` (DVLA catalog values that must
 * keep acronyms such as "BMW", "SRI NAV"), `email` (stored lowercase) and
 * long-form prose such as `internalNotes` / `description` (title casing whole
 * sentences would read badly).
 */
const TITLE_CASE_FIELDS = [
  "fullName",
  "firstName",
  "lastName",
  "preferredName",
  "colour",
];

/** Address sub-document fields that are title cased. */
const TITLE_CASE_ADDRESS_FIELDS = ["line1", "line2", "city", "county"];

/** Uppercase + trim. Returns the input untouched when it is not a string. */
const toUpperTrimmed = (value) => {
  if (typeof value !== "string") return value;
  return value.trim().toUpperCase();
};

/** Uppercase and remove spaces/punctuation — used for number plates. */
const toRegistration = (value) => {
  if (typeof value !== "string") return value;
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
};

/**
 * Title case a single word: "SMITH" -> "Smith", "mcdonald" -> "McDonald".
 * Digits are left alone so "12 high street" becomes "12 High Street".
 */
const titleCaseWord = (word) => {
  if (!word) return word;

  // Common name prefixes: mcdonald -> McDonald, macleod -> MacLeod.
  if (/^mc[a-z]/i.test(word) && word.length > 3) {
    return `Mc${titleCaseWord(word.slice(2))}`;
  }
  if (/^mac[a-z]/i.test(word) && word.length > 4) {
    return `Mac${titleCaseWord(word.slice(3))}`;
  }

  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

/**
 * Title case a token, keeping hyphen and apostrophe segments capitalised:
 * "anne-marie" -> "Anne-Marie", "o'brien" -> "O'Brien".
 */
const titleCaseToken = (token) =>
  token
    .split(/([-'’])/)
    .map((part) => (/^[-'’]$/.test(part) ? part : titleCaseWord(part)))
    .join("");

/**
 * First letter of every word capital, everything else lower case.
 *
 * Runs of whitespace are collapsed to a single space and the ends are trimmed,
 * so "  jane   sarah doe  " stores as "Jane Sarah Doe".
 *
 * Non-strings (undefined, null, numbers) pass straight through so this is safe
 * to use in Mongoose setters for optional paths.
 */
const toTitleCase = (value) => {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return "";

  return trimmed
    .split(/\s+/)
    .map(titleCaseToken)
    .join(" ");
};

/**
 * Normalise a payload object in place-safe fashion (returns a new object).
 * Only keys that are actually present are touched, so this is safe for PATCH
 * bodies where most fields are undefined.
 *
 * Also walks a nested `address` object, because postcode and the address lines
 * live there on User.
 */
const normalizeCaseFields = (payload) => {
  if (!payload || typeof payload !== "object") return payload;

  const result = { ...payload };

  for (const field of UPPERCASE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(result, field)) {
      result[field] = toUpperTrimmed(result[field]);
    }
  }

  for (const field of REGISTRATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(result, field)) {
      result[field] = toRegistration(result[field]);
    }
  }

  for (const field of TITLE_CASE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(result, field)) {
      result[field] = toTitleCase(result[field]);
    }
  }

  // Nested address object (User.address.*).
  if (result.address && typeof result.address === "object") {
    result.address = { ...result.address };

    for (const field of TITLE_CASE_ADDRESS_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(result.address, field)) {
        result.address[field] = toTitleCase(result.address[field]);
      }
    }

    if (Object.prototype.hasOwnProperty.call(result.address, "postcode")) {
      result.address.postcode = toUpperTrimmed(result.address.postcode);
    }
  }

  return result;
};

module.exports = {
  UPPERCASE_FIELDS,
  REGISTRATION_FIELDS,
  TITLE_CASE_FIELDS,
  TITLE_CASE_ADDRESS_FIELDS,
  toUpperTrimmed,
  toRegistration,
  toTitleCase,
  normalizeCaseFields,
};
