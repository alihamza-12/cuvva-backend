/*
 * Helpers for the "last 4 digits of the payment card" marker.
 *
 * The value is stored on the customer (User.lastFourDigits) so the next policy
 * for that customer can pre-fill the Create Policy form, and it is also copied
 * onto each policy (Policy.cardLast4) as the payment record for that policy.
 *
 * It is always exactly four digits, or nothing at all.
 */

/** Strip everything that is not a digit, capped at four characters. */
const normalizeCardLast4 = (value) => {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" && typeof value !== "number") return value;

  return String(value).replace(/\D/g, "").slice(0, 4);
};

/** True when the value is undefined/null/blank, i.e. "not provided". */
const isBlankCardLast4 = (value) =>
  value === undefined || value === null || String(value).trim() === "";

/** True when the value is exactly four digits. */
const isValidCardLast4 = (value) => /^\d{4}$/.test(String(value ?? "").trim());

/** The single message every surface uses, so the wording never drifts. */
const CARD_LAST4_MESSAGE =
  "Card last four digits must contain exactly 4 numbers.";

/**
 * Turn whatever arrived from a client into a storable value.
 *
 * Returns `{ ok, value, message }`:
 *   ok: true  -> `value` is the normalised 4 digit string (or null to clear)
 *   ok: false -> `message` explains what the user must fix
 */
const parseCardLast4 = (value) => {
  if (isBlankCardLast4(value)) {
    return { ok: true, value: null, message: null };
  }

  const normalized = normalizeCardLast4(value);

  if (!isValidCardLast4(normalized)) {
    return { ok: false, value: null, message: CARD_LAST4_MESSAGE };
  }

  return { ok: true, value: normalized, message: null };
};

module.exports = {
  normalizeCardLast4,
  isBlankCardLast4,
  isValidCardLast4,
  parseCardLast4,
  CARD_LAST4_MESSAGE,
};
