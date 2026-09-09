const assert = require("assert");
const {
  isDueForDeletion,
  RETENTION_DAYS,
} = require("../utils/cron/policyRetentionCleaner");

const DAY_MS = 24 * 60 * 60 * 1000;

const policy = (startDate, startTime, endDate, endTime, status = "Expired") => ({
  _id: "test-policy",
  policyNumber: "CUV-TEST-0001",
  status,
  startDate: new Date(startDate),
  endDate: new Date(endDate),
  startTime,
  endTime,
});

assert.strictEqual(RETENTION_DAYS, 20, "default retention must be 20 days");

// --- 1. Expired 21 days ago -> DELETED --------------------------------------
{
  const now = new Date("2026-09-30T12:00:00Z");
  // cover ended 2026-09-09 11:00 UK, i.e. 21 days before now
  const p = policy("2026-09-09", "09:00", "2026-09-09", "11:00");
  const verdict = isDueForDeletion(p, now);
  assert.strictEqual(verdict.due, true, "a policy that ended 21 days ago must be deleted");
}

// --- 2. Expired 19 days ago -> KEPT -----------------------------------------
{
  const now = new Date("2026-09-30T12:00:00Z");
  const p = policy("2026-09-11", "09:00", "2026-09-11", "11:00");
  const verdict = isDueForDeletion(p, now);
  assert.strictEqual(verdict.due, false, "a policy that ended 19 days ago must be kept");
  assert.strictEqual(verdict.reason, "skipped:within-retention");
}

// --- 3. Exactly on the boundary ---------------------------------------------
{
  const p = policy("2026-09-01", "10:00", "2026-09-01", "12:00");
  const endMs = new Date("2026-09-01T11:00:59.999Z").getTime(); // 12:00 BST + grace
  const justUnder = new Date(endMs + 20 * DAY_MS - 1000);
  const justOver = new Date(endMs + 20 * DAY_MS + 1000);
  assert.strictEqual(isDueForDeletion(p, justUnder).due, false, "1s before 20 days: keep");
  assert.strictEqual(isDueForDeletion(p, justOver).due, true, "1s after 20 days: delete");
}

// --- 4. Active is NEVER deleted, however old --------------------------------
{
  const now = new Date("2026-09-30T12:00:00Z");
  // Cover started months ago and runs for another year.
  const p = policy("2026-01-01", "00:00", "2027-01-01", "23:59", "Active");
  const verdict = isDueForDeletion(p, now);
  assert.strictEqual(verdict.due, false, "an Active policy must never be deleted");
  assert.strictEqual(verdict.reason, "skipped:active");
}

// --- 5. Upcoming is NEVER deleted -------------------------------------------
{
  const now = new Date("2026-09-30T12:00:00Z");
  const p = policy("2026-12-01", "10:00", "2026-12-01", "12:00", "Upcoming");
  const verdict = isDueForDeletion(p, now);
  assert.strictEqual(verdict.due, false, "an Upcoming policy must never be deleted");
  assert.strictEqual(verdict.reason, "skipped:upcoming");
}

// --- 6. Stale stored status does not fool the job ---------------------------
{
  // Stored status still says "Active" but cover actually ended 25 days ago.
  const now = new Date("2026-09-30T12:00:00Z");
  const p = policy("2026-09-05", "09:00", "2026-09-05", "10:00", "Active");
  const verdict = isDueForDeletion(p, now);
  assert.strictEqual(
    verdict.due,
    true,
    "status is recomputed, so a stale 'Active' row still gets cleaned up",
  );
}

// --- 7. Overnight policy resolves correctly, not deleted a day early --------
{
  // 23:00 -> 01:00 stored on ONE date: end must roll forward past start.
  const p = policy("2026-09-01", "23:00", "2026-09-01", "01:00");
  // True end is 2026-09-02 01:00 UK == 2026-09-02T00:00:59.999Z
  const trueEndMs = new Date("2026-09-02T00:00:59.999Z").getTime();

  const dayEarly = new Date(trueEndMs + 20 * DAY_MS - DAY_MS);
  assert.strictEqual(
    isDueForDeletion(p, dayEarly).due,
    false,
    "overnight policy must not be deleted a day early",
  );

  const onTime = new Date(trueEndMs + 20 * DAY_MS + 1000);
  assert.strictEqual(isDueForDeletion(p, onTime).due, true);
}

// --- 8. BST/GMT changeover is exact, not an hour out ------------------------
{
  // Cover ends 2026-10-25 (the day UK clocks go back).
  const p = policy("2026-10-25", "00:30", "2026-10-25", "02:30");
  const verdict20 = isDueForDeletion(p, new Date("2026-11-14T00:00:00Z"));
  const verdict21 = isDueForDeletion(p, new Date("2026-11-16T00:00:00Z"));
  assert.strictEqual(verdict20.due, false, "19-ish days after a DST end: keep");
  assert.strictEqual(verdict21.due, true, "22 days after a DST end: delete");
}

// --- 9. Cancelled is treated like Expired (documented default) --------------
{
  const now = new Date("2026-09-30T12:00:00Z");
  const p = policy("2026-09-01", "09:00", "2026-09-01", "11:00", "Cancelled");
  const verdict = isDueForDeletion(p, now);
  assert.strictEqual(
    verdict.due,
    true,
    "Cancelled is deleted 20 days after its end date (flagged default)",
  );
}

// --- 10. Unparseable dates are never deleted --------------------------------
{
  const now = new Date("2026-09-30T12:00:00Z");
  const broken = {
    status: "Expired",
    startDate: null,
    endDate: null,
    startTime: "nonsense",
    endTime: "nonsense",
  };
  const verdict = isDueForDeletion(broken, now);
  assert.strictEqual(verdict.due, false);
  assert.strictEqual(verdict.reason, "skipped:unparseable-dates");
}

// --- 11. Idempotency: re-running on a kept policy still keeps it ------------
{
  const now = new Date("2026-09-30T12:00:00Z");
  const p = policy("2026-09-11", "09:00", "2026-09-11", "11:00");
  assert.strictEqual(isDueForDeletion(p, now).due, false);
  assert.strictEqual(isDueForDeletion(p, now).due, false);
}

console.log(
  "Policy retention tests passed: 21d deleted, 19d kept, boundary exact, Active/Upcoming skipped, stale status recomputed, overnight, BST changeover, Cancelled, unparseable, idempotent.",
);
