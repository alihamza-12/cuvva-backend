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
      const year = this.startDate
        ? this.startDate.getFullYear()
        : new Date().getFullYear();
      const sequenceCount = await mongoose.model("Policy").countDocuments({
        policyNumber: { $regex: `^POL-${year}-` },
      });
      this.policyNumber = generatePolicyNumber(year, sequenceCount + 1);
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
