const cron = require("node-cron");
const Policy = require("../../models/Policy");
const User = require("../../models/User");
const {
  processPolicyNotifications,
} = require("../../services/policyNotificationProcessor");
const { policyDateTimeToInstant } = require("../../utils/policyDateTime");

// UK business time — independent of the server's timezone (BST/GMT handled automatically)
const ukDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const ukTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23", // guarantees 00:00-23:59 (no "24:00" edge on any ICU build)
});

/*
 * Status is decided by the SAME Europe/London wall-clock instants used by the
 * notification processor and the customer UI (policyDateTimeToInstant):
 *
 *   now <  start        -> stays Upcoming
 *   start <= now < end  -> Active
 *   now >= end          -> Expired
 *
 * The old implementation compared stored UTC-midnight Date objects against
 * UK date strings and lexicographic time strings, which could flip a policy
 * to Expired at the wrong moment (e.g. exactly when its start time arrived).
 * Evaluating real instants in JS removes every timezone/type edge case.
 */
const updatePolicyStatuses = async () => {
  try {
    const now = new Date();
    const nowMs = now.getTime();
    const currentDateStr = ukDateFmt.format(now); // YYYY-MM-DD in UK
    const currentTimeStr = ukTimeFmt.format(now); // HH:MM in UK

    console.log(
      `⏱️ Running Background Status Check [${currentDateStr} ${currentTimeStr} UK]...`,
    );

    const [upcomingPolicies, activePolicies] = await Promise.all([
      Policy.find({ status: "Upcoming" }).select(
        "_id startDate startTime endDate endTime",
      ),
      Policy.find({ status: "Active" }).select(
        "_id startDate startTime endDate endTime",
      ),
    ]);

    const activateIds = [];
    const expireIds = [];

    for (const policy of upcomingPolicies) {
      const start = policyDateTimeToInstant(policy.startDate, policy.startTime);
      const end = policyDateTimeToInstant(policy.endDate, policy.endTime);
      if (!start || !end) continue;
      if (nowMs >= end.getTime()) {
        // Start and end both passed while it was still Upcoming.
        expireIds.push(policy._id);
      } else if (nowMs >= start.getTime()) {
        activateIds.push(policy._id);
      }
    }

    for (const policy of activePolicies) {
      const end = policyDateTimeToInstant(policy.endDate, policy.endTime);
      if (end && nowMs >= end.getTime()) {
        expireIds.push(policy._id);
      }
    }

    let activatedCount = 0;
    let expiredCount = 0;

    if (activateIds.length > 0) {
      const activated = await Policy.updateMany(
        { _id: { $in: activateIds } },
        { $set: { status: "Active" } },
      );
      activatedCount = activated.modifiedCount;
    }

    if (expireIds.length > 0) {
      const expired = await Policy.updateMany(
        { _id: { $in: expireIds } },
        { $set: { status: "Expired" } },
      );
      expiredCount = expired.modifiedCount;
    }

    const reactivatedCustomers = await User.updateMany(
      {
        role: "Customer",
        status: "Suspended",
        suspendedUntil: { $ne: null, $lte: now },
      },
      {
        $set: {
          status: "Active",
          suspendedAt: null,
          suspendedUntil: null,
          suspendedBy: null,
        },
      },
    );

    try {
      await processPolicyNotifications(now);
    } catch (pushError) {
      // Push delivery is deliberately isolated from policy/customer transitions.
      console.error("[push] Notification worker failed:", pushError.message);
    }

    if (
      activatedCount > 0 ||
      expiredCount > 0 ||
      reactivatedCustomers.modifiedCount > 0
    ) {
      console.log(
        `🔄 System Auto-Updated: ${activatedCount} Activated, ${expiredCount} Expired, ${reactivatedCustomers.modifiedCount} Customer Suspensions Ended.`,
      );
    }
  } catch (err) {
    console.error("❌ Error running background policy updater:", err.message);
  }
};

const startPolicyStatusUpdater = () => {
  cron.schedule("* * * * *", updatePolicyStatuses);
  console.log(
    "[cron] Policy Status Automated Worker Scheduled Successfully (UK time).",
  );
};

module.exports = {
  startPolicyStatusUpdater,
  updatePolicyStatuses,
};
