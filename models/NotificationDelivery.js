const mongoose = require("mongoose");

const notificationDeliverySchema = new mongoose.Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Policy",
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["UPCOMING_5_MINUTES", "ACTIVE"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "sending", "sent", "failed"],
      default: "pending",
    },
    attemptCount: { type: Number, default: 0 },
    claimedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    oneSignalMessageId: { type: String, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

notificationDeliverySchema.index(
  { policyId: 1, type: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  "NotificationDelivery",
  notificationDeliverySchema,
);
