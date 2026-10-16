const express = require("express");
const CuvvafyPricing = require("../models/CuvvafyPricing");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const router = express.Router();

/*
 * GET /api/cuvvafy-pricing/public
 * Public endpoint for Cuvvafy (Tempify) to fetch active pricing config
 * No auth required, but rate limited
 * Returns only active pricing, no sensitive fields
 * MUST be defined BEFORE auth middleware
 */
router.get("/public", async (req, res, next) => {
  try {
    const config = await CuvvafyPricing.getGlobalConfig();
    if (!config.isActive) {
      return res.status(503).json({ message: "Pricing is temporarily unavailable" });
    }

    const toPlain = (map) => {
      if (!map) return {};
      if (map instanceof Map) {
        const obj = {};
        for (const [k, v] of map.entries()) obj[k] = v;
        return obj;
      }
      return map;
    };

    const plainPricing = (cat) => ({
      hours: toPlain(cat?.hours),
      days: toPlain(cat?.days),
      weeks: toPlain(cat?.weeks),
    });

    res.json({
      success: true,
      config: {
        durationOptions: config.durationOptions,
        pricingMode: config.pricingMode,
        categoryModes: config.categoryModes,
        pricing: {
          present: plainPricing(config.pricing?.present),
          past: plainPricing(config.pricing?.past),
          future: plainPricing(config.pricing?.future),
        },
        formula: config.formula,
        graceMinutes: config.graceMinutes,
        currency: config.currency,
      },
    });
  } catch (err) {
    next(err);
  }
});

// All routes below require Super Admin
router.use(verifyJWT, authorizeRoles("Super Admin"));

/*
 * GET /api/cuvvafy-pricing
 * Returns global pricing config, creates default if not exists
 */
router.get("/", async (req, res, next) => {
  try {
    const config = await CuvvafyPricing.getGlobalConfig();

    // Convert Maps to plain objects for frontend
    const toPlain = (map) => {
      if (!map) return {};
      if (map instanceof Map) {
        const obj = {};
        for (const [k, v] of map.entries()) obj[k] = v;
        return obj;
      }
      // If already plain object (from lean or JSON)
      if (typeof map === "object") {
        // Handle case where it's a Mongoose Map that got toObject'd
        const obj = {};
        for (const key in map) {
          if (Object.prototype.hasOwnProperty.call(map, key) && !key.startsWith("$")) {
            obj[key] = map[key];
          }
        }
        // If it's actually a Map-like with entries
        if (Object.keys(obj).length === 0 && map.entries) {
          for (const [k, v] of map.entries()) obj[k] = v;
        }
        return Object.keys(obj).length > 0 ? obj : map;
      }
      return map;
    };

    const plainPricing = (cat) => ({
      hours: toPlain(cat?.hours),
      days: toPlain(cat?.days),
      weeks: toPlain(cat?.weeks),
    });

    const response = {
      _id: config._id,
      configId: config.configId,
      durationOptions: config.durationOptions,
      pricingMode: config.pricingMode,
      categoryModes: config.categoryModes,
      pricing: {
        present: plainPricing(config.pricing?.present),
        past: plainPricing(config.pricing?.past),
        future: plainPricing(config.pricing?.future),
      },
      formula: config.formula,
      graceMinutes: config.graceMinutes,
      currency: config.currency,
      isActive: config.isActive,
      updatedAt: config.updatedAt,
      createdAt: config.createdAt,
    };

    res.json({ success: true, config: response });
  } catch (err) {
    next(err);
  }
});

/*
 * PUT /api/cuvvafy-pricing
 * Updates global pricing config — super admin only
 * Body: { durationOptions, pricingMode, categoryModes, pricing, formula, graceMinutes, currency }
 */
router.put("/", async (req, res, next) => {
  try {
    const {
      durationOptions,
      pricingMode,
      categoryModes,
      pricing,
      formula,
      graceMinutes,
      currency,
    } = req.body;

    // Validation
    if (durationOptions) {
      const { hours, days, weeks } = durationOptions;
      if (hours && (!Array.isArray(hours) || hours.some((n) => !Number.isInteger(n) || n < 1 || n > 365))) {
        return res.status(400).json({ message: "Invalid hours durationOptions" });
      }
      if (days && (!Array.isArray(days) || days.some((n) => !Number.isInteger(n) || n < 1 || n > 365))) {
        return res.status(400).json({ message: "Invalid days durationOptions" });
      }
      if (weeks && (!Array.isArray(weeks) || weeks.some((n) => !Number.isInteger(n) || n < 1 || n > 52))) {
        return res.status(400).json({ message: "Invalid weeks durationOptions" });
      }
    }

    if (pricingMode && !["flat", "formula", "both"].includes(pricingMode)) {
      return res.status(400).json({ message: "Invalid pricingMode" });
    }

    if (categoryModes) {
      for (const cat of ["present", "past", "future"]) {
        if (categoryModes[cat] && !["flat", "formula", "both"].includes(categoryModes[cat])) {
          return res.status(400).json({ message: `Invalid categoryModes.${cat}` });
        }
      }
    }

    if (graceMinutes !== undefined && (typeof graceMinutes !== "number" || graceMinutes < 0 || graceMinutes > 1440)) {
      return res.status(400).json({ message: "graceMinutes must be 0-1440" });
    }

    // Validate pricing maps
    const validatePricingCategory = (cat, name) => {
      if (!cat) return;
      for (const unit of ["hours", "days", "weeks"]) {
        if (cat[unit]) {
          for (const [key, value] of Object.entries(cat[unit])) {
            const numKey = Number(key);
            if (!Number.isInteger(numKey) || numKey < 1) {
              return `Invalid ${name}.${unit} key ${key}`;
            }
            if (typeof value !== "number" || value < 0 || value > 100000) {
              return `Invalid ${name}.${unit}[${key}] price ${value}`;
            }
          }
        }
      }
      return null;
    };

    if (pricing) {
      for (const cat of ["present", "past", "future"]) {
        const err = validatePricingCategory(pricing[cat], `pricing.${cat}`);
        if (err) return res.status(400).json({ message: err });
      }
    }

    const validateFormulaCategory = (cat, name) => {
      if (!cat) return;
      for (const unit of ["hours", "days", "weeks"]) {
        if (cat[unit]) {
          const { base, perExtra } = cat[unit];
          if (base !== undefined && (typeof base !== "number" || base < 0 || base > 100000)) {
            return `Invalid ${name}.${unit}.base ${base}`;
          }
          if (perExtra !== undefined && (typeof perExtra !== "number" || perExtra < 0 || perExtra > 100000)) {
            return `Invalid ${name}.${unit}.perExtra ${perExtra}`;
          }
        }
      }
      return null;
    };

    if (formula) {
      for (const cat of ["present", "past", "future"]) {
        const err = validateFormulaCategory(formula[cat], `formula.${cat}`);
        if (err) return res.status(400).json({ message: err });
      }
    }

    let config = await CuvvafyPricing.getGlobalConfig();

    // Helper to convert plain object to Map
    const toMap = (obj) => {
      if (!obj) return new Map();
      const m = new Map();
      for (const [k, v] of Object.entries(obj)) {
        m.set(String(k), Number(v));
      }
      return m;
    };

    if (durationOptions) {
      if (durationOptions.hours) config.durationOptions.hours = durationOptions.hours.map((n) => Math.floor(n)).filter((n) => n >= 1).sort((a, b) => a - b);
      if (durationOptions.days) config.durationOptions.days = durationOptions.days.map((n) => Math.floor(n)).filter((n) => n >= 1).sort((a, b) => a - b);
      if (durationOptions.weeks) config.durationOptions.weeks = durationOptions.weeks.map((n) => Math.floor(n)).filter((n) => n >= 1).sort((a, b) => a - b);
    }

    if (pricingMode) config.pricingMode = pricingMode;
    if (categoryModes) {
      if (categoryModes.present) config.categoryModes.present = categoryModes.present;
      if (categoryModes.past) config.categoryModes.past = categoryModes.past;
      if (categoryModes.future) config.categoryModes.future = categoryModes.future;
    }

    if (pricing) {
      for (const cat of ["present", "past", "future"]) {
        if (pricing[cat]) {
          if (pricing[cat].hours) config.pricing[cat].hours = toMap(pricing[cat].hours);
          if (pricing[cat].days) config.pricing[cat].days = toMap(pricing[cat].days);
          if (pricing[cat].weeks) config.pricing[cat].weeks = toMap(pricing[cat].weeks);
        }
      }
    }

    if (formula) {
      for (const cat of ["present", "past", "future"]) {
        if (formula[cat]) {
          for (const unit of ["hours", "days", "weeks"]) {
            if (formula[cat][unit]) {
              if (formula[cat][unit].base !== undefined) config.formula[cat][unit].base = Number(formula[cat][unit].base);
              if (formula[cat][unit].perExtra !== undefined) config.formula[cat][unit].perExtra = Number(formula[cat][unit].perExtra);
            }
          }
        }
      }
    }

    if (graceMinutes !== undefined) config.graceMinutes = Math.floor(graceMinutes);
    if (currency) config.currency = currency;

    config.updatedBy = req.user._id;
    await config.save();

    res.json({ success: true, message: "Cuvvafy pricing updated", config });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
