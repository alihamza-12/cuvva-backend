const mongoose = require("mongoose");
const {
  generatePolicyNumber,
} = require("../utils/helpers/policyNumberGenerator");

const { Schema } = mongoose;

const POLICY_TYPE = [
  "Temporary Car",
  "Temporary Van",
  "Learner Driver",
  "Impound",
  "Motorhome",
  "Drive Away",
];

const COVERAGE_TYPE = ["Comprehensive", "Third Party Only"];

const UNDERWRITER = ["Wakam", "ERS Syndicate", "Crawford"];

const POLICY_STATUS = ["Upcoming", "Active", "Expired", "Cancelled"];

const PolicySchema = new Schema(
  {
    policyNumber: { type: String, required: true },

    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // Store pence only. Example: £34.50 => 3450
    premiumAmount: { type: Number, required: true },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    startTime: { type: String, required: false },
    endTime: { type: String, required: false },

    policyType: { type: String, enum: POLICY_TYPE, required: true },
    coverageType: { type: String, enum: COVERAGE_TYPE, required: true },
    underwriter: { type: String, enum: UNDERWRITER, required: true },

    status: {
      type: String,
      enum: POLICY_STATUS,
      default: "Upcoming",
      index: true,
    },

    internalNotes: { type: String },
  },
  { timestamps: true },
);

// Generate formatted policyNumber on save if missing/empty.
PolicySchema.pre("save", async function preSave(next) {
  try {
    if (!this.policyNumber || String(this.policyNumber).trim() === "") {
      const year = this.startDate
        ? this.startDate.getFullYear()
        : new Date().getFullYear();

      // Basic deterministic sequence placeholder:
      // For real uniqueness/sequence concurrency-safe logic,
      // implement a separate counter collection later.
      const existing = await mongoose.model("Policy").countDocuments({
        policyNumber: { $regex: `^POL-${year}-` },
      });

      this.policyNumber = generatePolicyNumber(year, existing + 1);
    }

    next();
  } catch (err) {
    next(err);
  }
});

// Query Performance Indexes
PolicySchema.index({ customerId: 1, status: 1 });
PolicySchema.index({ createdBy: 1 });
PolicySchema.index({ policyNumber: 1 });

module.exports = mongoose.model("Policy", PolicySchema);
