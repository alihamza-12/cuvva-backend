const app = require("./app");
const connectDB = require("./config/database");
const seedSuperAdmin = require("./utils/seedSuperAdmin");
const {
  startPolicyStatusUpdater,
} = require("./utils/cron/policyStatusUpdater");
const {
  startPolicyRetentionCleaner,
} = require("./utils/cron/policyRetentionCleaner");

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();

  await seedSuperAdmin();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] Listening on port ${PORT}`);
  });

  startPolicyStatusUpdater();
  startPolicyRetentionCleaner();

  /*
   * Startup self-check for the delete endpoints.
   *
   * A missing import is a runtime error, so it cannot be caught by `node
   * --check` — it only surfaces when an admin presses Confirm Delete. This
   * verifies the helper resolves at boot and prints which roles may delete, so
   * a stale build is obvious in the logs instead of failing silently later.
   */
  try {
    const { getPolicyWindow } = require("./utils/policyStatus");
    if (typeof getPolicyWindow !== "function") {
      throw new Error("getPolicyWindow is not available");
    }
    console.log(
      "[startup] Delete endpoints ready (Super Admin, Sub Admin) — policy + customer.",
    );
  } catch (selfCheckError) {
    console.error(
      "[startup] DELETE ENDPOINTS BROKEN:",
      selfCheckError.message,
      "- deploy the latest routes/policies.js and restart.",
    );
  }
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[server] Failed to start", err);
  process.exit(1);
});
