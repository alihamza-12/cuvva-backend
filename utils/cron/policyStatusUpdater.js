
const cron = require("node-cron");
const Policy = require("../../models/Policy");

const updatePolicyStatuses = async () => {
  try {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const currentDateStr = `${year}-${month}-${day}`; 

    const currentTimeStr = now.toTimeString().split(" ")[0].substring(0, 5); 

    console.log(
      `⏱️ Running Background Status Check [${currentDateStr} ${currentTimeStr} LOCAL]...`,
    );

    const activated = await Policy.updateMany(
      {
        status: "Upcoming",
        $or: [
          { startDate: { $lt: new Date(currentDateStr) } },
          {
            startDate: new Date(currentDateStr),
            startTime: { $lte: currentTimeStr },
          },
        ],
      },
      { $set: { status: "Active" } },
    );

    const expired = await Policy.updateMany(
      {
        status: "Active",
        $or: [
          { endDate: { $lt: new Date(currentDateStr) } },
          {
            endDate: new Date(currentDateStr),
            endTime: { $lte: currentTimeStr },
          },
        ],
      },
      { $set: { status: "Expired" } },
    );

    if (activated.modifiedCount > 0 || expired.modifiedCount > 0) {
      console.log(
        `🔄 System Auto-Updated: ${activated.modifiedCount} Activated, ${expired.modifiedCount} Expired.`,
      );
    }
  } catch (err) {
    console.error("❌ Error running background policy updater:", err.message);
  }
};

const startPolicyStatusUpdater = () => {
  cron.schedule("* * * * *", updatePolicyStatuses);
  console.log("[cron] Policy Status Automated Worker Scheduled Successfully.");
};

module.exports = {
  startPolicyStatusUpdater,
};
