const express = require("express");
const router = express.Router();
const Vehicle = require("../models/Vehicle");

// --- Auth Middleware Import ---
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

// --- Route 1: Manually Register a New Vehicle (Admin Only) ---
/**
 * @route   POST /api/vehicles
 * @desc    Allows Super Admins/Sub Admins to add a vehicle spec to the database
 * @access  Private (Admin/Sub-Admin Only)
 */
router.post("/", verifyJWT, authorizeRoles("Super Admin", "Sub Admin"), async (req, res) => {
  try {
    const { registration, make, model, colour, year, fuelType, ...otherSpecs } = req.body;

    const cleanedRegistration = registration.toUpperCase().replace(/\s+/g, "");

    const vehicleExists = await Vehicle.findOne({ registration: cleanedRegistration });
    if (vehicleExists) {
      return res.status(400).json({
        success: false,
        message: "A vehicle with this registration plate is already registered in the database.",
      });
    }

    const newVehicle = await Vehicle.create({
      registration: cleanedRegistration,
      make,
      model,
      colour,
      year,
      fuelType,
      ...otherSpecs,
      createdBy: req.user._id, 
    });

    return res.status(201).json({
      success: true,
      message: "Vehicle registered successfully into the global system catalog.",
      vehicle: newVehicle,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error during vehicle registration.",
      error: err.message,
    });
  }
});

// --- Route 2: Global Registration Plate Lookup (All Authenticated Users) ---
/**
 * @route   GET /api/vehicles/lookup/:registration
 * @desc    Finds a car specification from our database registry by plate number
 * @access  Private (Customer, Sub Admin, Super Admin)
 */
router.get("/lookup/:registration", verifyJWT, async (req, res) => {
  try {
    const cleanedRegistration = req.params.registration.toUpperCase().replace(/\s+/g, "");

    const vehicle = await Vehicle.findOne({ registration: cleanedRegistration });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "This vehicle is not yet registered in our system. Please contact a platform administrator to input its details.",
      });
    }

    return res.status(200).json({
      success: true,
      source: "Local Database Registry",
      vehicle,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Server error during vehicle look up sequence.",
      error: err.message,
    });
  }
});

module.exports = router;