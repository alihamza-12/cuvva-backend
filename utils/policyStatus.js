const { policyDateTimeToInstant } = require("./policyDateTime");

/*
 * SINGLE SOURCE OF TRUTH for "is this policy Upcoming / Active / Expired?".
 *
 * Previously the cron, the REST responses, the push processor and the customer
 * UI each decided this independently, so they could disagree — which is how a
 * live policy ended up displayed (and stored) as "Expired".
 *
 * Rules, all evaluated on real Europe/London instants (GMT/BST safe):
 *
 *   now <  start                  -> Upcoming
 *   start <= now <= end + 59.999s -> Active
 *   now  >  end + 59.999s         -> Expired
 *   "Cancelled"                   -> never recomputed (manual terminal state)
 *
 * Two safeguards that fix the "expires the moment it starts" bug:
 *
 *  1. END-MINUTE GRACE — the stored endTime is the LAST COVERED MINUTE, so an
 *     end time of 10:59 keeps cover alive until 10:59:59.999. The old code cut
 *     cover at 10:59:00 and lost the final minute.
 *
 *  2. OVERNIGHT ROLL-FORWARD — if the resolved end instant is at or before the
 *     start (e.g. 23:00 -> 01:00 saved on a single date), the end is rolled
 *     forward whole days until it is after the start. Without this the policy
 *     resolved to a negative-length window and the cron expired it instantly.
 */

// Cover survives to the end of the stored end minute.
const END_MINUTE_GRACE_MS = 60 * 1000 - 1;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const getPolicyWindow = (policy) => {
  if (!policy) return null;

  const start = policyDateTimeToInstant(policy.startDate, policy.startTime);
  const end = policyDateTimeToInstant(policy.endDate, policy.endTime);
  if (!start || !end) return null;

  const startMs = start.getTime();
  let endMs = end.getTime();

  // Safeguard 2: never allow a window that ends before it begins.
  let guard = 0;
  while (endMs <= startMs && guard < 366) {
    endMs += ONE_DAY_MS;
    guard += 1;
  }

  // Safeguard 1: the stored end minute is fully covered.
  endMs += END_MINUTE_GRACE_MS;

  return {
    start,
    end: new Date(endMs),
    startMs,
    endMs,
  };
};

const computePolicyStatus = (policy, now = new Date()) => {
  if (!policy) return null;

  // Cancelled is a deliberate, manual, terminal state.
  if (policy.status === "Cancelled") return "Cancelled";

  const window = getPolicyWindow(policy);
  // Unparseable dates: keep whatever is stored rather than guessing.
  if (!window) return policy.status || "Upcoming";

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  if (nowMs < window.startMs) return "Upcoming";
  if (nowMs <= window.endMs) return "Active";
  return "Expired";
};

/*
 * Returns a plain object of the policy with `status` replaced by the derived
 * value, so API consumers never see a status that has gone stale between the
 * background worker's ticks.
 */
const withDerivedStatus = (policy, now = new Date()) => {
  if (!policy) return policy;
  const plain =
    typeof policy.toObject === "function" ? policy.toObject() : { ...policy };
  plain.status = computePolicyStatus(plain, now);
  return plain;
};

const withDerivedStatuses = (policies, now = new Date()) =>
  (policies || []).map((policy) => withDerivedStatus(policy, now));

module.exports = {
  END_MINUTE_GRACE_MS,
  getPolicyWindow,
  computePolicyStatus,
  withDerivedStatus,
  withDerivedStatuses,
};
