function normalizeTime(input) {
  if (input == null) return null;
  let s = String(input).trim().toUpperCase();
  if (!s) return null;
  let mer = null;
  const mm = s.match(/(AM|PM)$/);
  if (mm) { mer = mm[1]; s = s.slice(0, -2).trim(); }
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] !== undefined ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (mer === "PM" && h >= 1 && h <= 11) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

module.exports = { normalizeTime };