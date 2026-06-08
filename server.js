const http = require("http");
const app = require("./app");
const connectDB = require("./config/database");
const {
  startPolicyStatusUpdater,
} = require("./utils/cron/policyStatusUpdater");

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();

  const server = http.createServer(app);

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] Listening on port ${PORT}`);
  });

  // Persistent background cron (in-memory).
  startPolicyStatusUpdater();
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[server] Failed to start", err);
  process.exit(1);
});
