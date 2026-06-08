const Policy = require("../../models/Policy");

let running = false;

/**
 * 5-minute background status in-memory cron job placeholder.
 * Will periodically update Policy.status based on start/end windows.
 */
async function tick() {
  // Placeholder implementation: no update logic yet.
  // Keeping the function to preserve long-running architecture.
  return;
}

function startPolicyStatusUpdater() {
  if (running) return;
  running = true;

  // Lazy-load node-cron to keep file lightweight.
  const cron = require("node-cron");

  // Every 5 minutes.
  cron.schedule("*/5 * * * *", async () => {
    try {
      await tick();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[cron] policyStatusUpdater failed", err);
    }
  });

  // eslint-disable-next-line no-console
  console.log("[cron] policyStatusUpdater started (*/5 * * * *)");
}

module.exports = { startPolicyStatusUpdater };
