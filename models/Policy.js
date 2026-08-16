const mongoose = require("mongoose");
const {
  generatePolicyNumber,
} = require("../utils/helpers/policyNumberGenerator");

const policySchema = new mongoose.Schema(
  {

    policyNumber: { type: String, unique: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, 
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
    }, 
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, 

    premiumAmount: { type: Number, required: true },
    excess: { type: Number, default: 500, min: 0 },
    cardLast4: {
      type: String,
      trim: true,
      match: [/^\d{4}$/, "Card last four digits must contain exactly 4 numbers."],
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startTime: { type: String, required: true }, 
    endTime: { type: String, required: true }, 

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

    internalNotes: { type: String, trim: true },
  },
  { timestamps: true },
);

policySchema.pre("save", async function (next) {
  try {
    if (!this.policyNumber || !this.policyNumber.trim()) {
      const Policy = mongoose.model("Policy");
      let candidate;
      let alreadyExists;

      do {
        candidate = generatePolicyNumber();
        alreadyExists = await Policy.exists({ policyNumber: candidate });
      } while (alreadyExists);

      this.policyNumber = candidate;
    }
    next();
  } catch (err) {
    next(err);
  }
});

policySchema.index({ customerId: 1, status: 1 });
policySchema.index({ vehicleId: 1 });
policySchema.index({ createdBy: 1 });
policySchema.index({ status: 1, startDate: 1, startTime: 1 });
policySchema.index({ status: 1, endDate: 1, endTime: 1 });

module.exports = mongoose.model("Policy", policySchema);
