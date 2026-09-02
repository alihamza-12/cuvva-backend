/*
 * The admin UI sends dates as masked "DD/MM/YYYY" strings (MaskedDateInput),
 * while some callers may send ISO "YYYY-MM-DD".  Passing "DD/MM/YYYY"
 * straight into new Date() makes JavaScript parse it US-style (MM/DD/YYYY),
 * silently swapping day and month — e.g. 02/09/2026 became 9 Feb 2026, which
 * made the status cron expire policies the moment they started.
 *
 * normalizeIncomingDate() returns a canonical "YYYY-MM-DD" string, or null
 * when the input is not a valid calendar date.
 */
const normalizeIncomingDate = (input) => {
  const value = String(input || "").trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value; // already ISO (date-only or full timestamp)
  }

  const masked = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!masked) return null;

  const day = Number(masked[1]);
  const month = Number(masked[2]);
  const year = Number(masked[3]);

  if (year < 1000 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  return `${masked[3]}-${masked[2]}-${masked[1]}`;
};

module.exports = { normalizeIncomingDate };
