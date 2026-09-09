const mongoose = require("mongoose");

/*
 * Archive of the customer -> vehicle relationship.
 *
 * A Vehicle is never linked directly to a Customer; the only thing that ties
 * them together is a Policy record. The retention job (see
 * utils/cron/policyRetentionCleaner.js) hard-deletes policies 20 days after
 * cover ends, which would destroy that link and empty the "customer's previous
 * cars" dropdown on the Create Policy screen.
 *
 * So before a policy is deleted, the pair is written here. One row per
 * customer+vehicle pair, upserted, with a running policy count.
 */
const customerVehicleHistorySchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    /** The end instant of the most recent policy for this pair. */
    lastUsedAt: { type: Date },
    /** How many policies this customer+vehicle pair has had. */
    policyCount: { type: Number, default: 0 },
    /** Kept for support queries after the policy row itself is gone. */
    lastPolicyNumber: { type: String },
  },
  { timestamps: true },
);

// One row per pair — the retention job relies on this for its upsert.
customerVehicleHistorySchema.index(
  { customerId: 1, vehicleId: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  "CustomerVehicleHistory",
  customerVehicleHistorySchema,
);
