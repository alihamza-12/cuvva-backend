const cron = require("node-cron");
const Policy = require("../../models/Policy");

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

const updatePolicyStatuses = async () => {
  try {
    const now = new Date();
    const currentDateStr = ukDateFmt.format(now); // YYYY-MM-DD in UK
    const currentTimeStr = ukTimeFmt.format(now); // HH:MM in UK

    console.log(
      `⏱️ Running Background Status Check [${currentDateStr} ${currentTimeStr} UK]...`
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
      { $set: { status: "Active" } }
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
      { $set: { status: "Expired" } }
    );

    if (activated.modifiedCount > 0 || expired.modifiedCount > 0) {
      console.log(
        `🔄 System Auto-Updated: ${activated.modifiedCount} Activated, ${expired.modifiedCount} Expired.`
      );
    }
  } catch (err) {
    console.error("❌ Error running background policy updater:", err.message);
  }
};

const startPolicyStatusUpdater = () => {
  cron.schedule("* * * * *", updatePolicyStatuses);
  console.log(
    "[cron] Policy Status Automated Worker Scheduled Successfully (UK time)."
  );
};

module.exports = {
  startPolicyStatusUpdater,
};
