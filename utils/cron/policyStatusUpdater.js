const cron = require("node-cron");
const Policy = require("../../models/Policy");
const User = require("../../models/User");
const {
  processPolicyNotifications,
} = require("../../services/policyNotificationProcessor");
const { computePolicyStatus } = require("../../utils/policyStatus");

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
 * Status is derived by utils/policyStatus.computePolicyStatus — the single
 * source of truth shared with the REST layer, the push processor and the UI:
 *
 *   now <  start                  -> Upcoming
 *   start <= now <= end + 59.999s -> Active
 *   now  >  end + 59.999s         -> Expired
 *   Cancelled                     -> untouched (manual terminal state)
 *
 * IMPORTANT: this worker now re-evaluates EVERY non-cancelled policy, not just
 * the Upcoming/Active ones. The old query excluded "Expired", so any policy
 * that was wrongly expired (for example an overnight window whose end instant
 * resolved before its start) could never recover — it stayed Expired forever
 * even while sitting inside its own cover window. Re-checking everything means
 * such a row self-heals on the next tick.
 */
const updatePolicyStatuses = async () => {
  try {
    const now = new Date();
    const currentDateStr = ukDateFmt.format(now); // YYYY-MM-DD in UK
    const currentTimeStr = ukTimeFmt.format(now); // HH:MM in UK

    // Every non-cancelled policy is re-evaluated so a wrongly-stored status
    // (in either direction) is corrected on the very next tick.
    const policies = await Policy.find({ status: { $ne: "Cancelled" } }).select(
      "_id status startDate startTime endDate endTime",
    );

    const buckets = { Upcoming: [], Active: [], Expired: [] };

    for (const policy of policies) {
      const derived = computePolicyStatus(policy, now);
      if (!derived || derived === "Cancelled") continue;
      if (derived !== policy.status && buckets[derived]) {
        buckets[derived].push(policy._id);
      }
    }

    const applyStatus = async (status) => {
      const ids = buckets[status];
      if (!ids.length) return 0;
      const result = await Policy.updateMany(
        { _id: { $in: ids }, status: { $ne: "Cancelled" } },
        { $set: { status } },
      );
      return result.modifiedCount;
    };

    const activatedCount = await applyStatus("Active");
    const expiredCount = await applyStatus("Expired");
    const revertedCount = await applyStatus("Upcoming");

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
      revertedCount > 0 ||
      reactivatedCustomers.modifiedCount > 0
    ) {
      console.log(
        `🔄 [${currentDateStr} ${currentTimeStr} UK] System Auto-Updated: ${activatedCount} Activated, ${expiredCount} Expired, ${revertedCount} Restored to Upcoming, ${reactivatedCustomers.modifiedCount} Customer Suspensions Ended.`,
      );
    }
  } catch (err) {
    console.error("❌ Error running background policy updater:", err.message);
  }
};

const startPolicyStatusUpdater = () => {
  // Every 15 seconds so transitions land promptly (was once a minute).
  cron.schedule("*/15 * * * * *", updatePolicyStatuses);
  // Run once immediately so a restart never leaves stale statuses behind.
  updatePolicyStatuses().catch(() => {});
  console.log(
    "[cron] Policy Status Automated Worker Scheduled Successfully (UK time).",
  );
};

module.exports = {
  startPolicyStatusUpdater,
  updatePolicyStatuses,
};
