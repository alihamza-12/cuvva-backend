const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema(
  {
    // --- Relational Links & Audit ---
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, // The Super Admin or Sub-Admin who manually added this car to the system

    // --- Core Identity ---
    registration: {
      type: String,
      required: true,
      unique: true, // Prevents admins from adding the same plate twice
      uppercase: true,
      trim: true,
    }, // UK Plate Number (e.g., "BD55SMR")
    make: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    colour: { type: String, trim: true },
    year: { type: Number, required: true },

    // --- Technical Specifications ---
    fuelType: {
      type: String,
      enum: ["PETROL", "DIESEL", "ELECTRIC", "HYBRID"],
      required: true,
    },
    engineCapacityCC: { type: Number },
    powerBHP: { type: Number },
    topSpeed: { type: Number },
    cylinders: { type: Number },
    fuelConsumptionMPG: { type: Number },

    // --- DVLA Compliance Status (Manually Managed) ---
    motStatus: { type: String, default: "Valid" },
    motExpiryDate: { type: Date },
    taxStatus: { type: String, default: "Paid" },
    taxDueDate: { type: Date },
    registrationKeeper: { type: String, trim: true },
    v5cIssueDate: { type: Date },
    co2Emissions: { type: Number },
    euroStatus: { type: String },
    wheelplan: { type: String },
  },
  { timestamps: true },
);



module.exports = mongoose.model("Vehicle", vehicleSchema);
