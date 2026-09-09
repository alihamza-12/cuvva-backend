/*
 * Case normalisation helpers.
 *
 * Mongoose's `uppercase: true` schema option only runs on document setters, so
 * it does NOT apply to `findOneAndUpdate` / `updateOne` style queries. These
 * helpers let a route normalise an incoming body explicitly before writing, so
 * the value stored in MongoDB is always uppercase regardless of which write
 * path is used.
 *
 * Only codes and identifiers are uppercased. Human-readable prose (names,
 * city, colour, notes) and `email` (deliberately stored lowercase) are never
 * touched.
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
 * Normalise a payload object in place-safe fashion (returns a new object).
 * Only keys that are actually present are touched, so this is safe for PATCH
 * bodies where most fields are undefined.
 *
 * Also walks a nested `address` object, because postcode lives there on User.
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

  // Nested address object (User.address.postcode).
  if (result.address && typeof result.address === "object") {
    result.address = { ...result.address };
    if (
      Object.prototype.hasOwnProperty.call(result.address, "postcode")
    ) {
      result.address.postcode = toUpperTrimmed(result.address.postcode);
    }
  }

  return result;
};

module.exports = {
  UPPERCASE_FIELDS,
  REGISTRATION_FIELDS,
  toUpperTrimmed,
  toRegistration,
  normalizeCaseFields,
};
