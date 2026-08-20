const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema(
  {

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    associatedAdmins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    registration: {
      type: String,
      required: true,
      unique: true, 
      uppercase: true,
      trim: true,
    }, 
    make: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
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
    bodyStyle: { type: String, trim: true },
    variant: { type: String, trim: true },
    transmission: { type: String, trim: true },
    numberOfDoors: { type: Number },
    numberOfSeats: { type: Number },
    vehicleInsuranceGroup: { type: Number },
    vehicleInsuranceGroupOutOf: { type: Number },
    abiCode: { type: String, trim: true },
    engineCode: { type: String, trim: true },
    engineNumber: { type: String, trim: true },
    immobiliser: { type: String, trim: true },
    indicativeValue: { type: Number },
    driverSide: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    lookupSource: { type: String, trim: true },
    regCheckData: { type: mongoose.Schema.Types.Mixed },
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

vehicleSchema.index({ associatedAdmins: 1 });

module.exports = mongoose.model("Vehicle", vehicleSchema);
