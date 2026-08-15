const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema(
  {

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, 

    registration: {
      type: String,
      required: true,
      unique: true, 
      uppercase: true,
      trim: true,
    }, 
    make: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    colour: { type: String, trim: true },
    year: { type: Number, required: true },
    vehicleIdentificationNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },

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
