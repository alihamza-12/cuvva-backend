const express = require("express");
const router = express.Router();
const Vehicle = require("../models/Vehicle");

const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

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

router.get("/lookup/:registration", async (req, res) => {
  try {
    const cleanedRegistration = req.params.registration
      .toUpperCase()
      .replace(/\s+/g, "");

    const lookupFilter = { registration: cleanedRegistration };

    if (req.user?.role === "Sub Admin") {
      lookupFilter.createdBy = req.user._id;
    }

    let vehicleQuery = Vehicle.findOne(lookupFilter);

    if (req.user?.role === "Super Admin") {
      vehicleQuery = vehicleQuery.populate("createdBy", "fullName role");
    } else {
      vehicleQuery = vehicleQuery.select("-createdBy");
    }

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

router.get(
  "/all",
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {

      const vehicleFilter =
        req.user?.role === "Sub Admin" ? { createdBy: req.user._id } : {};

      let vehicleQuery = Vehicle.find(vehicleFilter).sort({ createdAt: -1 });

      if (req.user?.role === "Super Admin") {
        vehicleQuery = vehicleQuery.populate(
          "createdBy",
          "fullName role email",
        );
      } else {
        vehicleQuery = vehicleQuery.select("-createdBy");
      }

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

router.patch(
  "/:id",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      const vehicle = await Vehicle.findById(req.params.id);

      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found." });
      }

      if (
        req.user.role === "Sub Admin" &&
        String(vehicle.createdBy) !== String(req.user._id)
      ) {
        return res.status(403).json({
          message: "Forbidden: You can only update vehicles you created.",
        });
      }

      const allowedFields = [
        "registration",
        "make",
        "model",
        "colour",
        "year",
        "vehicleIdentificationNumber",
        "fuelType",
        "engineCapacityCC",
        "powerBHP",
        "topSpeed",
        "cylinders",
        "fuelConsumptionMPG",
        "motStatus",
        "motExpiryDate",
        "taxStatus",
        "taxDueDate",
        "registrationKeeper",
        "v5cIssueDate",
        "co2Emissions",
        "euroStatus",
        "wheelplan",
      ];

      if (req.body.registration !== undefined) {
        const cleanedRegistration = String(req.body.registration)
          .toUpperCase()
          .replace(/\s+/g, "");
        const duplicate = await Vehicle.findOne({
          _id: { $ne: vehicle._id },
          registration: cleanedRegistration,
        });

        if (duplicate) {
          return res.status(400).json({
            message: "Another vehicle already uses this registration.",
          });
        }

        req.body.registration = cleanedRegistration;
      }

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) vehicle[field] = req.body[field];
      }

      await vehicle.save();

      return res.status(200).json({
        success: true,
        message: "Vehicle updated successfully.",
        vehicle,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Server error while updating vehicle.",
        error: error.message,
      });
    }
  },
);

module.exports = router;
