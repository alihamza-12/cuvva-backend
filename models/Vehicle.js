const mongoose = require("mongoose");

const { Schema } = mongoose;

const DVLA_FUEL_TYPES = ["PETROL", "DIESEL", "ELECTRIC", "HYBRID"];

const VehicleSchema = new Schema(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    registration: { type: String, required: true, uppercase: true, trim: true },

    make: { type: String },
    model: { type: String },
    colour: { type: String },
    year: { type: Number },

    fuelType: { type: String, enum: DVLA_FUEL_TYPES },

    engineCapacityCC: { type: Number },
    powerBHP: { type: Number },
    topSpeed: { type: Number },
    cylinders: { type: Number },

    fuelConsumptionMPG: { type: Number },

    motExpiryDate: { type: Date },
    motStatus: { type: String },
    taxStatus: { type: String },
    taxDueDate: { type: Date },
    registrationKeeper: { type: String },

    v5cIssueDate: { type: Date },
    co2Emissions: { type: Number },
    euroStatus: { type: String },
    wheelplan: { type: String },
  },
  { timestamps: true },
);

// Query Performance Indexes
VehicleSchema.index({ registration: 1 });
VehicleSchema.index({ customerId: 1 });

module.exports = mongoose.model("Vehicle", VehicleSchema);
