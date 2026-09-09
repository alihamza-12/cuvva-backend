const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const Policy = require("../../models/Policy");
const AuditLog = require("../../models/AuditLog");
const NotificationDelivery = require("../../models/NotificationDelivery");
const CustomerVehicleHistory = require("../../models/CustomerVehicleHistory");
const { getPolicyWindow, computePolicyStatus } = require("../policyStatus");

/*
 * Retention sweep: permanently delete policies 20 days after their cover ended.
 *
 * THE RULE (exactly as specified):
 *   - status Upcoming or Active  -> skip, never delete
 *   - otherwise                  -> if the cover ended more than
 *                                   POLICY_RETENTION_DAYS ago, delete it
 *
 * The 20 days runs from the END of cover, not from creation, so a long-running
 * policy is never touched no matter how old it is.
 *
 * WHY THE STORED STATUS IS NOT TRUSTED
 * This job only wakes four times a day, so a policy can expire hours before it
 * runs while `policy.status` still reads "Active". The status is therefore
 * recomputed with computePolicyStatus() per policy rather than filtered in the
 * query. Likewise the end instant comes from getPolicyWindow(), which already
 * handles GMT/BST, the end-minute grace, and overnight roll-forward.
 *
 * BEFORE DELETING, the customer -> vehicle link is archived into
 * CustomerVehicleHistory. That link only exists on the Policy row, and the
 * Create Policy dropdown depends on it. If the archive write fails the policy
 * is skipped, never deleted — data loss is always the worse outcome.
 */

const RETENTION_DAYS = Number(process.env.POLICY_RETENTION_DAYS || 20);
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/* Coarse pre-filter slack. The precise decision is made per policy in JS; this
 * only narrows the candidate set. Two extra days absorbs timezone edges and
 * overnight roll-forward so nothing is missed. */
const PREFILTER_SLACK_MS = 2 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

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
  hourCycle: "h23",
});

/*
 * Per-policy certificate PDFs are generated on demand and streamed to the
 * client — nothing is persisted per policy today (the pdfs/ directory holds
 * only the two shared documents). This is kept as a safe no-op so the sweep
 * still cleans up if per-policy caching is ever introduced.
 */
const removeGeneratedCertificate = (policy) => {
  try {
    const pdfDir = path.join(__dirname, "..", "..", "pdfs");
    const candidate = path.join(
      pdfDir,
      `${String(policy.policyNumber || policy._id).replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`,
    );
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
  } catch {
    // Never let a filesystem problem block the database cleanup.
  }
};

/**
 * Decide whether a single policy is due for deletion.
 * Exported so the tests can exercise the rule without a database.
 */
const isDueForDeletion = (policy, now, retentionMs = RETENTION_MS) => {
  const status = computePolicyStatus(policy, now);

  // Client's rule: running or not-yet-started policies are always skipped.
  if (status === "Upcoming" || status === "Active") {
    return { due: false, reason: `skipped:${status.toLowerCase()}` };
  }

  const window = getPolicyWindow(policy);
  if (!window) {
    // Unparseable dates: never delete, surface it instead.
    return { due: false, reason: "skipped:unparseable-dates" };
  }

  const ageMs = now.getTime() - window.endMs;
  if (ageMs < retentionMs) {
    return { due: false, reason: "skipped:within-retention", endMs: window.endMs };
  }

  return { due: true, reason: "due", endMs: window.endMs, status };
};

/**
 * Run one retention sweep.
 * @param {{ dryRun?: boolean }} options
 * @returns {Promise<{deleted:number, skipped:number, failed:number, dryRun:boolean, candidates:Array}>}
 */
const runPolicyRetention = async (options = {}) => {
  const dryRun = Boolean(options.dryRun);
  const now = new Date();

  const summary = { deleted: 0, skipped: 0, failed: 0, dryRun, candidates: [] };

  try {
    // Coarse pre-filter so we never load the whole collection into memory.
    const cutoff = new Date(now.getTime() - RETENTION_MS - PREFILTER_SLACK_MS);

    const cursor = Policy.find({ endDate: { $lt: cutoff } })
      .select(
        "policyNumber customerId vehicleId status startDate endDate startTime endTime",
      )
      .batchSize(BATCH_SIZE)
      .cursor();

    for (
      let policy = await cursor.next();
      policy != null;
      policy = await cursor.next()
    ) {
      try {
        const verdict = isDueForDeletion(policy, now);

        if (!verdict.due) {
          summary.skipped += 1;
          if (verdict.reason === "skipped:unparseable-dates") {
            console.warn(
              `[retention] Policy ${policy.policyNumber || policy._id} has unparseable dates — skipped.`,
            );
          }
          continue;
        }

        if (dryRun) {
          summary.deleted += 1;
          summary.candidates.push({
            policyId: String(policy._id),
            policyNumber: policy.policyNumber || null,
            endedAt: new Date(verdict.endMs).toISOString(),
          });
          continue;
        }

        // (a) Archive the customer -> vehicle link FIRST. If this fails the
        //     policy is left in place, so the relationship is never lost.
        if (policy.customerId && policy.vehicleId) {
          await CustomerVehicleHistory.updateOne(
            { customerId: policy.customerId, vehicleId: policy.vehicleId },
            {
              $inc: { policyCount: 1 },
              $max: { lastUsedAt: new Date(verdict.endMs) },
              $set: { lastPolicyNumber: policy.policyNumber || null },
            },
            { upsert: true },
          );
        }

        // (b) Notification delivery rows for this policy.
        await NotificationDelivery.deleteMany({ policyId: policy._id });

        // (c) Any cached certificate on disk.
        removeGeneratedCertificate(policy);

        // (d) Audit trail — written before the row disappears.
        await AuditLog.create({
          action: "POLICY_AUTO_DELETED",
          module: "policies",
          targetId: String(policy._id),
          success: true,
          payloadBefore: {
            policyNumber: policy.policyNumber || null,
            customerId: String(policy.customerId || ""),
            vehicleId: String(policy.vehicleId || ""),
            endDate: policy.endDate,
            endTime: policy.endTime,
            endedAt: new Date(verdict.endMs).toISOString(),
            storedStatus: policy.status,
            derivedStatus: verdict.status,
            reason: `retention:${RETENTION_DAYS}d-after-expiry`,
          },
        });

        // (e) Finally remove the policy itself.
        await Policy.deleteOne({ _id: policy._id });
        summary.deleted += 1;
      } catch (policyError) {
        // One bad policy must never abort the sweep.
        summary.failed += 1;
        console.error(
          `[retention] Failed on policy ${policy?.policyNumber || policy?._id}:`,
          policyError.message,
        );
      }
    }

    if (summary.deleted > 0 || summary.failed > 0) {
      const currentDateStr = ukDateFmt.format(now);
      const currentTimeStr = ukTimeFmt.format(now);
      console.log(
        `🗑️ [${currentDateStr} ${currentTimeStr} UK] Retention${dryRun ? " (dry run)" : ""}: ${summary.deleted} policies ${dryRun ? "would be deleted" : "deleted"}, ${summary.skipped} skipped, ${summary.failed} failed.`,
      );
    }
  } catch (error) {
    console.error("❌ Error running policy retention sweep:", error.message);
  }

  return summary;
};

const startPolicyRetentionCleaner = () => {
  // Midnight, 06:00, midday and 18:00 — the four runs the client asked for.
  // The timezone option is essential: without it the schedule follows the
  // server clock and drifts by an hour across BST changeovers.
  cron.schedule("0 0,6,12,18 * * *", () => runPolicyRetention(), {
    timezone: "Europe/London",
  });

  console.log(
    `[cron] Policy Retention Cleaner Scheduled (00:00, 06:00, 12:00, 18:00 UK — ${RETENTION_DAYS} day retention).`,
  );
};

module.exports = {
  startPolicyRetentionCleaner,
  runPolicyRetention,
  isDueForDeletion,
  RETENTION_DAYS,
  RETENTION_MS,
};
