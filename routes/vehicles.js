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
router.post(
  "/",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      const {
        registration,
        make,
        model,
        colour,
        year,
        fuelType,
        ...otherSpecs
      } = req.body;

      const cleanedRegistration = registration
        .toUpperCase()
        .replace(/\s+/g, "");

      const vehicleExists = await Vehicle.findOne({
        registration: cleanedRegistration,
      });
      if (vehicleExists) {
        return res.status(400).json({
          success: false,
          message:
            "A vehicle with this registration plate is already registered in the database.",
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
        message:
          "Vehicle registered successfully into the global system catalog.",
        vehicle: newVehicle,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Server error during vehicle registration.",
        error: err.message,
      });
    }
  },
);

// --- Route 2: Global Registration Plate Lookup (Role-Based Visibility) ---
/**
 * @route   GET /api/vehicles/lookup/:registration
 * @access  Private (Customer, Sub Admin, Super Admin)
 */
router.get("/lookup/:registration", async (req, res) => {
  try {
    const cleanedRegistration = req.params.registration
      .toUpperCase()
      .replace(/\s+/g, "");

    // Start building the query
    let vehicleQuery = Vehicle.findOne({ registration: cleanedRegistration });

    // 🛡️ ROLE-BASED CONDITIONAL LOGIC
    if (req.user && req.user.role === "Super Admin") {
      // Super Admin sees everything + gets the creator's full name and role populated
      vehicleQuery = vehicleQuery.populate("createdBy", "fullName role");
    } else {
      // Customers and Sub Admins have the 'createdBy' field completely stripped out
      vehicleQuery = vehicleQuery.select("-createdBy");
    }

    // Execute the configured query
    const vehicle = await vehicleQuery;

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message:
          "This vehicle is not yet registered in our system. Please contact a platform administrator to input its details.",
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

// --- Route 3: Get All Vehicles (Administrative Dashboard Feed) ---
/**
 * @route   GET /api/vehicles
 * @desc    Returns a master list of all vehicles in the catalog
 * @access  Private (Super Admin and Sub Admin Only)
 */
router.get(
  "/all",
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      // Start building the query to find all vehicles and sort by newest first
      let vehicleQuery = Vehicle.find().sort({ createdAt: -1 });

      // 🛡️ ROLE-BASED VISIBILITY CONTROL
      if (req.user && req.user.role === "Super Admin") {
        // Super Admin sees every vehicle field + the creator's role, name, and email
        vehicleQuery = vehicleQuery.populate(
          "createdBy",
          "fullName role email",
        );
      } else {
        // Sub Admins see all vehicle asset details, but the 'createdBy' metadata is completely hidden
        vehicleQuery = vehicleQuery.select("-createdBy");
      }

      // Execute the database query
      const vehicles = await vehicleQuery;

      return res.status(200).json({
        success: true,
        count: vehicles.length,
        vehicles,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Server error while fetching the vehicle collection.",
        error: err.message,
      });
    }
  },
);

module.exports = router;
