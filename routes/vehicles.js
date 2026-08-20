const express = require("express");
const router = express.Router();
const Vehicle = require("../models/Vehicle");

const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const VEHICLE_FIELDS = [
  "make",
  "model",
  "description",
  "colour",
  "year",
  "vehicleIdentificationNumber",
  "fuelType",
  "engineCapacityCC",
  "bodyStyle",
  "variant",
  "transmission",
  "numberOfDoors",
  "numberOfSeats",
  "vehicleInsuranceGroup",
  "vehicleInsuranceGroupOutOf",
  "abiCode",
  "engineCode",
  "engineNumber",
  "immobiliser",
  "indicativeValue",
  "driverSide",
  "imageUrl",
  "lookupSource",
  "regCheckData",
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

const cleanRegistration = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const findVehicleByRegistration = async (registration) => {
  const cleanedRegistration = cleanRegistration(registration);
  if (!cleanedRegistration) return null;

  const exactVehicle = await Vehicle.findOne({
    registration: cleanedRegistration,
  });
  if (exactVehicle) return exactVehicle;

  // Legacy records may contain spaces, hyphens or lower-case characters.
  // Match those formatting differences without treating O and 0 as equal.
  const flexiblePattern = cleanedRegistration
    .split("")
    .join("[^A-Za-z0-9]*");

  return Vehicle.findOne({
    registration: new RegExp(`^${flexiblePattern}$`, "i"),
  });
};

const buildVehiclePayload = (body) => {
  const payload = {};
  for (const field of VEHICLE_FIELDS) {
    if (body[field] !== undefined) payload[field] = body[field];
  }

  if (payload.vehicleIdentificationNumber !== undefined) {
    payload.vehicleIdentificationNumber = String(
      payload.vehicleIdentificationNumber,
    )
      .trim()
      .toUpperCase();
  }
  if (payload.fuelType !== undefined) {
    payload.fuelType = String(payload.fuelType).trim().toUpperCase();
  }
  return payload;
};

const adminCanUseVehicle = (vehicle, adminId) =>
  String(vehicle.createdBy) === String(adminId) ||
  (vehicle.associatedAdmins || []).some(
    (associatedAdminId) => String(associatedAdminId) === String(adminId),
  );

router.post(
  "/",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      const cleanedRegistration = cleanRegistration(req.body.registration);
      if (!cleanedRegistration) {
        return res.status(400).json({
          success: false,
          message: "Vehicle registration is required.",
        });
      }

      const existingVehicle = await findVehicleByRegistration(
        cleanedRegistration,
      );

      if (existingVehicle) {
        if (!adminCanUseVehicle(existingVehicle, req.user._id)) {
          existingVehicle.associatedAdmins.addToSet(req.user._id);
          await existingVehicle.save();
        }

        return res.status(200).json({
          success: true,
          source: "Local Database Registry",
          message: "Existing vehicle linked to your account.",
          vehicle: existingVehicle,
        });
      }

      const vehiclePayload = buildVehiclePayload(req.body);
      const missingFields = ["make", "model", "year", "fuelType"].filter(
        (field) =>
          vehiclePayload[field] === undefined ||
          vehiclePayload[field] === null ||
          String(vehiclePayload[field]).trim() === "",
      );
      if (missingFields.length) {
        return res.status(400).json({
          success: false,
          message: `Complete the required vehicle fields: ${missingFields.join(", ")}.`,
        });
      }

      const newVehicle = await Vehicle.create({
        registration: cleanedRegistration,
        ...vehiclePayload,
        createdBy: req.user._id,
        associatedAdmins: [req.user._id],
      });

      return res.status(201).json({
        success: true,
        source: req.body.lookupSource === "regcheck" ? "RegCheck" : "Manual",
        message: "Vehicle registered and linked to your account.",
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

router.get(
  "/lookup/:registration",
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      const cleanedRegistration = cleanRegistration(req.params.registration);
      const vehicle = await findVehicleByRegistration(cleanedRegistration);

      if (!vehicle) {
        return res.status(404).json({
          success: false,
          code: "VEHICLE_NOT_FOUND",
          message: "This vehicle is not yet registered in our system.",
        });
      }

      if (!adminCanUseVehicle(vehicle, req.user._id)) {
        vehicle.associatedAdmins.addToSet(req.user._id);
        await vehicle.save();
      }

      let responseVehicle = vehicle;
      if (req.user.role === "Super Admin") {
        responseVehicle = await Vehicle.findById(vehicle._id)
          .populate("createdBy", "fullName role email")
          .populate("associatedAdmins", "fullName role email");
      }

      return res.status(200).json({
        success: true,
        source: "Local Database Registry",
        vehicle: responseVehicle,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Server error during vehicle look up sequence.",
        error: err.message,
      });
    }
  },
);

router.get(
  "/all",
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      const vehicleFilter =
        req.user.role === "Sub Admin"
          ? {
              $or: [
                { createdBy: req.user._id },
                { associatedAdmins: req.user._id },
              ],
            }
          : {};

      let vehicleQuery = Vehicle.find(vehicleFilter).sort({ createdAt: -1 });

      if (req.user.role === "Super Admin") {
        vehicleQuery = vehicleQuery
          .populate("createdBy", "fullName role email")
          .populate("associatedAdmins", "fullName role email");
      } else {
        vehicleQuery = vehicleQuery.select("-createdBy -associatedAdmins");
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
        !adminCanUseVehicle(vehicle, req.user._id)
      ) {
        return res.status(403).json({
          message: "Forbidden: This vehicle is not linked to your account.",
        });
      }

      if (req.body.registration !== undefined) {
        const cleanedRegistration = cleanRegistration(req.body.registration);
        const duplicate = await findVehicleByRegistration(cleanedRegistration);

        if (duplicate && String(duplicate._id) !== String(vehicle._id)) {
          return res.status(400).json({
            message: "Another vehicle already uses this registration.",
          });
        }
        vehicle.registration = cleanedRegistration;
      }

      Object.assign(vehicle, buildVehiclePayload(req.body));
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
