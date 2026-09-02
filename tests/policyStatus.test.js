const assert = require("assert");
const {
  computePolicyStatus,
  getPolicyWindow,
} = require("../utils/policyStatus");

const policy = (startDate, startTime, endDate, endTime, status = "Upcoming") => ({
  status,
  startDate: new Date(startDate),
  endDate: new Date(endDate),
  startTime,
  endTime,
});

// --- 1. BST (summer): 10:00-10:59 UK == 09:00Z .. 09:59:59.999Z -------------
const summer = policy("2026-09-02", "10:00", "2026-09-02", "10:59");
const summerWindow = getPolicyWindow(summer);
assert.strictEqual(summerWindow.start.toISOString(), "2026-09-02T09:00:00.000Z");
assert.strictEqual(
  new Date(summerWindow.endMs).toISOString(),
  "2026-09-02T09:59:59.999Z",
  "the stored end minute must be fully covered",
);

assert.strictEqual(computePolicyStatus(summer, new Date("2026-09-02T08:59:59Z")), "Upcoming");
// THE BUG: the exact start instant must be Active, never Expired.
assert.strictEqual(
  computePolicyStatus(summer, new Date("2026-09-02T09:00:00Z")),
  "Active",
  "a policy must be Active at the very instant it starts",
);
assert.strictEqual(computePolicyStatus(summer, new Date("2026-09-02T09:30:00Z")), "Active");
assert.strictEqual(computePolicyStatus(summer, new Date("2026-09-02T09:59:59Z")), "Active");
assert.strictEqual(computePolicyStatus(summer, new Date("2026-09-02T10:00:00Z")), "Expired");

// --- 2. GMT (winter): no offset --------------------------------------------
const winter = policy("2026-01-15", "09:00", "2026-01-15", "10:00");
assert.strictEqual(computePolicyStatus(winter, new Date("2026-01-15T08:59:59Z")), "Upcoming");
assert.strictEqual(computePolicyStatus(winter, new Date("2026-01-15T09:00:00Z")), "Active");
assert.strictEqual(computePolicyStatus(winter, new Date("2026-01-15T10:00:30Z")), "Active");
assert.strictEqual(computePolicyStatus(winter, new Date("2026-01-15T10:01:00Z")), "Expired");

// --- 3. OVERNIGHT saved on a SINGLE date (23:00 -> 01:00) -------------------
// This is the case that resolved end BEFORE start and made the old cron expire
// the policy the instant it began.
const overnightSameDate = policy("2026-09-02", "23:00", "2026-09-02", "01:00");
const onWindow = getPolicyWindow(overnightSameDate);
assert.ok(onWindow.endMs > onWindow.startMs, "end must roll forward past start");
assert.strictEqual(
  computePolicyStatus(overnightSameDate, new Date("2026-09-02T22:00:00Z")),
  "Active",
  "overnight policy must be Active at its start, not Expired",
);
assert.strictEqual(
  computePolicyStatus(overnightSameDate, new Date("2026-09-02T23:30:00Z")),
  "Active",
);
assert.strictEqual(
  computePolicyStatus(overnightSameDate, new Date("2026-09-03T00:30:00Z")),
  "Expired",
);

// --- 4. Overnight spanning two dates (the correct data shape) --------------
const overnight = policy("2026-09-02", "23:00", "2026-09-03", "01:00");
assert.strictEqual(computePolicyStatus(overnight, new Date("2026-09-02T21:59:00Z")), "Upcoming");
assert.strictEqual(computePolicyStatus(overnight, new Date("2026-09-02T23:30:00Z")), "Active");
assert.strictEqual(computePolicyStatus(overnight, new Date("2026-09-03T00:30:00Z")), "Expired");

// --- 5. A stale stored status is always corrected --------------------------
const staleExpired = policy("2026-09-02", "10:00", "2026-09-02", "12:00", "Expired");
assert.strictEqual(
  computePolicyStatus(staleExpired, new Date("2026-09-02T10:00:00Z")),
  "Active",
  "a policy inside its window must never stay Expired",
);
const staleUpcoming = policy("2026-09-02", "10:00", "2026-09-02", "12:00", "Upcoming");
assert.strictEqual(
  computePolicyStatus(staleUpcoming, new Date("2026-09-02T10:00:00Z")),
  "Active",
);

// --- 6. Cancelled is terminal and never recomputed -------------------------
const cancelled = policy("2026-09-02", "10:00", "2026-09-02", "12:00", "Cancelled");
assert.strictEqual(
  computePolicyStatus(cancelled, new Date("2026-09-02T10:30:00Z")),
  "Cancelled",
);

// --- 7. Unparseable rows keep their stored status --------------------------
assert.strictEqual(
  computePolicyStatus({ status: "Active", startDate: null, startTime: "bad" }, new Date()),
  "Active",
);

// --- 8. Multi-day policy ---------------------------------------------------
const multiDay = policy("2026-09-02", "08:00", "2026-09-05", "18:00");
assert.strictEqual(computePolicyStatus(multiDay, new Date("2026-09-01T12:00:00Z")), "Upcoming");
assert.strictEqual(computePolicyStatus(multiDay, new Date("2026-09-03T12:00:00Z")), "Active");
assert.strictEqual(computePolicyStatus(multiDay, new Date("2026-09-06T12:00:00Z")), "Expired");

console.log(
  "Policy status tests passed: BST, GMT, end-minute grace, overnight (same-date + cross-date), stale-status healing, cancelled, multi-day.",
);
