const express = require("express");
const router = express.Router();
const Vehicle = require("../models/Vehicle");
const Policy = require("../models/Policy");

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

const objectIdOf = (value) => value?._id || value;

const adminCanUseVehicle = (vehicle, adminId) =>
  String(objectIdOf(vehicle.createdBy)) === String(adminId) ||
  (vehicle.associatedAdmins || []).some(
    (associatedAdmin) => String(objectIdOf(associatedAdmin)) === String(adminId),
  );

const hasProviderData = (vehicle) => {
  const data = vehicle?.regCheckData;
  return Boolean(
    data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Object.keys(data).length > 0,
  );
};

const getSourceType = (vehicle) =>
  vehicle?.lookupSource === "regcheck" || hasProviderData(vehicle)
    ? "automatic"
    : "manual";

const getDeletePermission = ({ vehicle, user, referencedByPolicy = false }) => {
  const isCreator =
    String(objectIdOf(vehicle.createdBy)) === String(user._id);
  const sourceType = getSourceType(vehicle);

  if (sourceType === "automatic") {
    return {
      canDelete: false,
      deleteDisabledReason: "Automatically verified vehicles cannot be deleted.",
    };
  }
  if (!isCreator) {
    return {
      canDelete: false,
      deleteDisabledReason:
        "Only the admin who originally added this vehicle can delete it.",
    };
  }
  if (referencedByPolicy) {
    return {
      canDelete: false,
      deleteDisabledReason:
        "This vehicle cannot be deleted because it is referenced by one or more policies.",
    };
  }
  return { canDelete: true, deleteDisabledReason: null };
};

const presentVehicle = (
  vehicle,
  user,
  { includeAssociatedSubAdmins = false, referencedByPolicy = false } = {},
) => {
  const plain = vehicle.toObject ? vehicle.toObject() : { ...vehicle };
  const isCreator =
    String(objectIdOf(plain.createdBy)) === String(user._id);
  const associatedSubAdmins = [];
  const seen = new Set();

  if (includeAssociatedSubAdmins) {
    for (const admin of plain.associatedAdmins || []) {
      if (!admin || admin.role !== "Sub Admin") continue;
      const id = String(objectIdOf(admin));
      if (seen.has(id)) continue;
      seen.add(id);
      associatedSubAdmins.push({
        _id: objectIdOf(admin),
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        isCreator: String(objectIdOf(plain.createdBy)) === id,
      });
    }

    if (plain.createdBy?.role === "Sub Admin") {
      const creatorId = String(objectIdOf(plain.createdBy));
      if (!seen.has(creatorId)) {
        associatedSubAdmins.unshift({
          _id: objectIdOf(plain.createdBy),
          fullName: plain.createdBy.fullName,
          email: plain.createdBy.email,
          role: plain.createdBy.role,
          isCreator: true,
        });
      }
    }
  }

  const result = {
    ...plain,
    sourceType: getSourceType(plain),
    isCreator,
    permissions: getDeletePermission({
      vehicle: plain,
      user,
      referencedByPolicy,
    }),
  };

  if (includeAssociatedSubAdmins) {
    result.associatedSubAdmins = associatedSubAdmins;
    result.associatedSubAdminCount = associatedSubAdmins.length;
  } else {
    delete result.associatedAdmins;
  }

  return result;
};

const getPopulatedVehicle = (id) =>
  Vehicle.findById(id)
    .populate("createdBy", "fullName role email")
    .populate("associatedAdmins", "fullName role email");

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

        const populatedVehicle = await getPopulatedVehicle(existingVehicle._id);
        return res.status(200).json({
          success: true,
          source: "Local Database Registry",
          message: "Existing vehicle linked to your account.",
          vehicle: presentVehicle(populatedVehicle, req.user, {
            includeAssociatedSubAdmins: req.user.role === "Super Admin",
          }),
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

      vehiclePayload.lookupSource =
        vehiclePayload.lookupSource === "regcheck" &&
        hasProviderData(vehiclePayload)
          ? "regcheck"
          : "manual";

      const newVehicle = await Vehicle.create({
        registration: cleanedRegistration,
        ...vehiclePayload,
        createdBy: req.user._id,
        associatedAdmins: [req.user._id],
      });
      const populatedVehicle = await getPopulatedVehicle(newVehicle._id);

      return res.status(201).json({
        success: true,
        source:
          vehiclePayload.lookupSource === "regcheck" ? "Automatic" : "Manual",
        message: "Vehicle registered and linked to your account.",
        vehicle: presentVehicle(populatedVehicle, req.user, {
          includeAssociatedSubAdmins: req.user.role === "Super Admin",
        }),
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

      const [responseVehicle, referencedByPolicy] = await Promise.all([
        getPopulatedVehicle(vehicle._id),
        Policy.exists({ vehicleId: vehicle._id }),
      ]);

      return res.status(200).json({
        success: true,
        source: "Local Database Registry",
        vehicle: presentVehicle(responseVehicle, req.user, {
          includeAssociatedSubAdmins: req.user.role === "Super Admin",
          referencedByPolicy: Boolean(referencedByPolicy),
        }),
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

      const vehicles = await Vehicle.find(vehicleFilter)
        .sort({ createdAt: -1 })
        .populate("createdBy", "fullName role email")
        .populate("associatedAdmins", "fullName role email");
      const presentedVehicles = vehicles.map((vehicle) =>
        presentVehicle(vehicle, req.user, {
          includeAssociatedSubAdmins: req.user.role === "Super Admin",
        }),
      );

      return res.status(200).json({
        success: true,
        count: presentedVehicles.length,
        vehicles: presentedVehicles,
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

      const wasAutomaticallySourced = getSourceType(vehicle) === "automatic";
      const updatePayload = buildVehiclePayload(req.body);
      const incomingAutomaticData =
        updatePayload.lookupSource === "regcheck" &&
        hasProviderData(updatePayload);

      if (wasAutomaticallySourced || incomingAutomaticData) {
        updatePayload.lookupSource = "regcheck";
      } else {
        updatePayload.lookupSource = "manual";
      }

      Object.assign(vehicle, updatePayload);
      await vehicle.save();
      const [populatedVehicle, referencedByPolicy] = await Promise.all([
        getPopulatedVehicle(vehicle._id),
        Policy.exists({ vehicleId: vehicle._id }),
      ]);

      return res.status(200).json({
        success: true,
        message: "Vehicle updated successfully.",
        vehicle: presentVehicle(populatedVehicle, req.user, {
          includeAssociatedSubAdmins: req.user.role === "Super Admin",
          referencedByPolicy: Boolean(referencedByPolicy),
        }),
      });
    } catch (error) {
      return res.status(500).json({
        message: "Server error while updating vehicle.",
        error: error.message,
      });
    }
  },
);

router.delete(
  "/:id",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      const vehicle = await Vehicle.findById(req.params.id);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found." });
      }

      const sourceType = getSourceType(vehicle);
      if (sourceType === "automatic") {
        return res.status(403).json({
          message: "Automatically verified vehicles cannot be deleted.",
        });
      }

      if (String(vehicle.createdBy) !== String(req.user._id)) {
        return res.status(403).json({
          message:
            "Only the admin who originally added this vehicle can delete it.",
        });
      }

      const referencedByPolicy = await Policy.exists({ vehicleId: vehicle._id });
      if (referencedByPolicy) {
        return res.status(409).json({
          message:
            "This vehicle cannot be deleted because it is referenced by one or more policies.",
        });
      }

      await Vehicle.deleteOne({ _id: vehicle._id });
      return res.status(200).json({
        success: true,
        message: "Vehicle deleted successfully.",
      });
    } catch (error) {
      return res.status(500).json({
        message: "Server error while deleting vehicle.",
        error: error.message,
      });
    }
  },
);

module.exports = router;
