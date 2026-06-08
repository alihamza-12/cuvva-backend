const mongoose = require("mongoose");
const {
  generatePolicyNumber,
} = require("../utils/helpers/policyNumberGenerator");

const policySchema = new mongoose.Schema(
  {
    // --- Core Identification & Links ---
    policyNumber: { type: String, unique: true }, // Added unique constraint for absolute safety
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, // Broker ID

    // --- Calculations & Calendars ---
    premiumAmount: { type: Number, required: true }, // Stored as pence integers (£34.50 is 3450)
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startTime: String, // Clean optional declaration
    endTime: String, // Clean optional declaration

    // --- Contract Categorization (Inline Enums) ---
    policyType: {
      type: String,
      enum: [
        "Temporary Car",
        "Temporary Van",
        "Learner Driver",
        "Impound",
        "Motorhome",
        "Drive Away",
      ],
      required: true,
    },
    coverageType: {
      type: String,
      enum: ["Comprehensive", "Third Party Only"],
      required: true,
    },
    underwriter: {
      type: String,
      enum: ["Wakam", "ERS Syndicate", "Crawford"],
      required: true,
    },
    status: {
      type: String,
      enum: ["Upcoming", "Active", "Expired", "Cancelled"],
      default: "Upcoming",
    },

    internalNotes: String,
  },
  { timestamps: true },
);

// --- Auto-Generate Policy Number Sequence ---
policySchema.pre("save", async function (next) {
  try {
    if (!this.policyNumber || !this.policyNumber.trim()) {
      const year = this.startDate
        ? this.startDate.getFullYear()
        : new Date().getFullYear();

      // Look up previous policies for this year to handle sequence order
      const sequenceCount = await mongoose.model("Policy").countDocuments({
        policyNumber: { $regex: `^POL-${year}-` },
      });

      this.policyNumber = generatePolicyNumber(year, sequenceCount + 1);
    }
    next();
  } catch (err) {
    next(err); // Safely forward database execution errors
  }
});

// --- High-Speed Query Performance Indexes ---
policySchema.index({ policyNumber: 1 });
policySchema.index({ customerId: 1, status: 1 });
policySchema.index({ createdBy: 1 });

module.exports = mongoose.model("Policy", policySchema);
