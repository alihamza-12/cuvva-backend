/**
 * Pure helper creating formatting sequences for policy numbers.
 * Format: POL-YYYY-XXXXX
 */
function padLeft(num, width) {
  const s = String(num);
  if (s.length >= width) return s;
  return `${"0".repeat(width - s.length)}${s}`;
}

function generatePolicyNumber(year, sequence) {
  const y = year || new Date().getFullYear();
  const seq = padLeft(sequence, 5);
  return `POL-${y}-${seq}`;
}

module.exports = { generatePolicyNumber };
