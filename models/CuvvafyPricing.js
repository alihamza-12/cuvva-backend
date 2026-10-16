const mongoose = require("mongoose");

/*
 * Cuvvafy dynamic pricing config — managed from Cuvva super admin dashboard.
 * Shared MongoDB `cuvva` database, so Tempify/Cuvvafy reads same config.
 *
 * Categories:
 *  - present: Immediate start / today / now
 *  - past: Backdated start (start time before now)
 *  - future: Scheduled future start (start time after now)
 *
 * Each category has:
 *  - durationOptions: editable arrays for hours/days/weeks
 *  - pricingMode: flat | formula | both
 *  - flat pricing maps: price per exact duration value
 *  - formula: base + perExtra * (value-1)
 *
 * Pricing is always in GBP.
 */

const priceMapSchema = new mongoose.Schema(
  {
    // Using Mixed to allow dynamic keys like "1", "3", "5", etc.
    // Example: { "1": 15.13, "3": 24.83, "5": 34.53 }
  },
  { _id: false, strict: false }
);

const formulaUnitSchema = new mongoose.Schema(
  {
    base: { type: Number, default: 0 },
    perExtra: { type: Number, default: 0 },
  },
  { _id: false }
);

const categoryPricingSchema = new mongoose.Schema(
  {
    hours: { type: Map, of: Number, default: {} },
    days: { type: Map, of: Number, default: {} },
    weeks: { type: Map, of: Number, default: {} },
  },
  { _id: false }
);

const categoryFormulaSchema = new mongoose.Schema(
  {
    hours: { type: formulaUnitSchema, default: () => ({ base: 15.13, perExtra: 4.85 }) },
    days: { type: formulaUnitSchema, default: () => ({ base: 29.95, perExtra: 18.5 }) },
    weeks: { type: formulaUnitSchema, default: () => ({ base: 109.95, perExtra: 79 }) },
  },
  { _id: false }
);

const cuvvafyPricingSchema = new mongoose.Schema(
  {
    configId: { type: String, default: "global", unique: true, index: true },

    durationOptions: {
      hours: { type: [Number], default: [1, 3, 5, 12, 24] },
      days: { type: [Number], default: [1, 2, 3, 4, 5, 6, 7] },
      weeks: { type: [Number], default: [1, 2, 3, 4] },
    },

    pricingMode: {
      type: String,
      enum: ["flat", "formula", "both"],
      default: "both",
    },

    categoryModes: {
      present: { type: String, enum: ["flat", "formula", "both"], default: "both" },
      past: { type: String, enum: ["flat", "formula", "both"], default: "both" },
      future: { type: String, enum: ["flat", "formula", "both"], default: "both" },
    },

    // Flat pricing: exact price per duration value
    pricing: {
      present: { type: categoryPricingSchema, default: () => ({}) },
      past: { type: categoryPricingSchema, default: () => ({}) },
      future: { type: categoryPricingSchema, default: () => ({}) },
    },

    // Formula pricing: base + perExtra * (value-1)
    formula: {
      present: { type: categoryFormulaSchema, default: () => ({}) },
      past: { type: categoryFormulaSchema, default: () => ({}) },
      future: { type: categoryFormulaSchema, default: () => ({}) },
    },

    graceMinutes: { type: Number, default: 5, min: 0, max: 1440 },
    currency: { type: String, default: "GBP" },

    isActive: { type: Boolean, default: true },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "cuvvafy_pricings",
  }
);

// Ensure single global config
cuvvafyPricingSchema.statics.getGlobalConfig = async function () {
  let config = await this.findOne({ configId: "global" });
  if (!config) {
    // Create default config with flat prices derived from original formula
    const defaultFlat = {
      hours: new Map([
        ["1", 15.13],
        ["3", 24.83],
        ["5", 34.53],
        ["12", 68.48],
        ["24", 126.68],
      ]),
      days: new Map([
        ["1", 29.95],
        ["2", 48.45],
        ["3", 66.95],
        ["4", 85.45],
        ["5", 103.95],
        ["6", 122.45],
        ["7", 140.95],
      ]),
      weeks: new Map([
        ["1", 109.95],
        ["2", 188.95],
        ["3", 267.95],
        ["4", 346.95],
      ]),
    };

    const pastFlat = {
      hours: new Map([
        ["1", 20.43],
        ["3", 33.52],
        ["5", 46.62],
        ["12", 92.45],
        ["24", 171.02],
      ]),
      days: new Map([
        ["1", 40.43],
        ["2", 65.41],
        ["3", 90.38],
        ["4", 115.36],
        ["5", 140.33],
        ["6", 165.31],
        ["7", 190.28],
      ]),
      weeks: new Map([
        ["1", 148.43],
        ["2", 255.08],
        ["3", 361.73],
        ["4", 468.38],
      ]),
    };

    config = await this.create({
      configId: "global",
      durationOptions: {
        hours: [1, 3, 5, 12, 24],
        days: [1, 2, 3, 4, 5, 6, 7],
        weeks: [1, 2, 3, 4],
      },
      pricingMode: "both",
      categoryModes: {
        present: "both",
        past: "both",
        future: "both",
      },
      pricing: {
        present: defaultFlat,
        past: pastFlat,
        future: defaultFlat,
      },
      formula: {
        present: {
          hours: { base: 15.13, perExtra: 4.85 },
          days: { base: 29.95, perExtra: 18.5 },
          weeks: { base: 109.95, perExtra: 79 },
        },
        past: {
          hours: { base: 20.43, perExtra: 6.55 },
          days: { base: 40.43, perExtra: 24.98 },
          weeks: { base: 148.43, perExtra: 106.65 },
        },
        future: {
          hours: { base: 15.13, perExtra: 4.85 },
          days: { base: 29.95, perExtra: 18.5 },
          weeks: { base: 109.95, perExtra: 79 },
        },
      },
      graceMinutes: 5,
      currency: "GBP",
      isActive: true,
    });
  }
  return config;
};

module.exports = mongoose.model("CuvvafyPricing", cuvvafyPricingSchema);
