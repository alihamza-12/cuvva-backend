const NotificationDelivery = require("../models/NotificationDelivery");
const Policy = require("../models/Policy");
const { policyDateTimeToInstant } = require("../utils/policyDateTime");
const { sendPolicyNotification } = require("./oneSignalNotificationService");

const MAX_ATTEMPTS = 3;
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;

const sanitizeDeliveryError = (error) => {
  const raw = error?.response?.data?.errors || error?.message || "Unknown error";
  let message;
  try {
    message = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    message = "Notification provider error";
  }
  const configuredKey = process.env.ONESIGNAL_REST_API_KEY;
  if (configuredKey) message = message.split(configuredKey).join("[REDACTED]");
  return message
    .replace(/\b(Key|Bearer)\s+[A-Za-z0-9._~+\/-]+/gi, "$1 [REDACTED]")
    .slice(0, 500);
};

const claimDelivery = async (policy, type, now) => {
  const staleClaim = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const retryBefore = new Date(now.getTime() - RETRY_DELAY_MS);

  const claimedExisting = await NotificationDelivery.findOneAndUpdate(
    {
      policyId: policy._id,
      type,
      attemptCount: { $lt: MAX_ATTEMPTS },
      $or: [
        { status: "failed", updatedAt: { $lte: retryBefore } },
        { status: "sending", claimedAt: { $lte: staleClaim } },
      ],
    },
    {
      $set: {
        status: "sending",
        claimedAt: now,
        lastError: null,
      },
      $inc: { attemptCount: 1 },
    },
    { new: true },
  );
  if (claimedExisting) return claimedExisting;

  try {
    return await NotificationDelivery.create({
      policyId: policy._id,
      customerId: policy.customerId._id,
      type,
      status: "sending",
      attemptCount: 1,
      claimedAt: now,
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
};

const deliver = async (policy, type, now) => {
  const delivery = await claimDelivery(policy, type, now);
  if (!delivery) return;

  const customer = policy.customerId;
  const preferenceKey =
    type === "UPCOMING_5_MINUTES" ? "policyUpcoming" : "policyActive";

  if (customer.notificationPreferences?.[preferenceKey] === false) {
    delivery.status = "sent";
    delivery.sentAt = now;
    delivery.lastError = "Skipped because the customer disabled this notification.";
    await delivery.save();
    return;
  }

  try {
    const result = await sendPolicyNotification({
      policy,
      customer,
      vehicle: policy.vehicleId,
      type,
      now,
    });
    delivery.status = "sent";
    delivery.sentAt = new Date();
    delivery.oneSignalMessageId = result.id;
    delivery.lastError = null;
    await delivery.save();
    console.log("[push] Policy notification sent", {
      policyId: String(policy._id),
      customerId: String(customer._id),
      type,
      oneSignalMessageId: result.id,
      recipients: result.recipients,
    });
  } catch (error) {
    delivery.status = "failed";
    delivery.lastError = sanitizeDeliveryError(error);
    await delivery.save();
    console.error("[push] Policy notification failed", {
      policyId: String(policy._id),
      customerId: String(customer._id),
      type,
      attempt: delivery.attemptCount,
      error: delivery.lastError,
    });
  }
};

const processPolicyNotifications = async (now = new Date()) => {
  if (!process.env.ONESIGNAL_APP_ID || !process.env.ONESIGNAL_REST_API_KEY) {
    return;
  }

  const policies = await Policy.find({
    status: { $in: ["Upcoming", "Active"] },
  })
    .populate(
      "customerId",
      "notificationPreferences role status",
    )
    .populate("vehicleId", "registration make model");

  for (const policy of policies) {
    if (!policy.customerId || policy.customerId.role !== "Customer") continue;
    if (!policy.vehicleId || policy.customerId.status !== "Active") continue;

    const start = policyDateTimeToInstant(policy.startDate, policy.startTime);
    const end = policyDateTimeToInstant(policy.endDate, policy.endTime);
    if (!start || !end || now >= end) continue;

    const untilStart = start.getTime() - now.getTime();
    if (
      policy.status === "Upcoming" &&
      untilStart > 0 &&
      untilStart <= 5 * 60 * 1000
    ) {
      await deliver(policy, "UPCOMING_5_MINUTES", now);
    }

    if (
      policy.status === "Active" &&
      now >= start
    ) {
      await deliver(policy, "ACTIVE", now);
    }
  }
};

module.exports = { processPolicyNotifications };
