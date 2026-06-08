const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema(
  {
    // --- Relational Links ---
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, // Sub-Admin issuing broker

    // --- Core Identity ---
    registration: { type: String, required: true, uppercase: true, trim: true }, // UK Plate Number
    make: String,
    model: String,
    colour: String,
    year: Number,

    // --- Technical Specifications ---
    fuelType: {
      type: String,
      enum: ["PETROL", "DIESEL", "ELECTRIC", "HYBRID"],
    },
    engineCapacityCC: Number,
    powerBHP: Number,
    topSpeed: Number,
    cylinders: Number,
    fuelConsumptionMPG: Number,

    // --- DVLA Compliance Status ---
    motStatus: String,
    motExpiryDate: Date,
    taxStatus: String,
    taxDueDate: Date,
    registrationKeeper: String,
    v5cIssueDate: Date,
    co2Emissions: Number,
    euroStatus: String,
    wheelplan: String,
  },
  { timestamps: true },
);

// --- High-Speed Query Indexes ---
vehicleSchema.index({ registration: 1 });
vehicleSchema.index({ customerId: 1 });

module.exports = mongoose.model("Vehicle", vehicleSchema);
