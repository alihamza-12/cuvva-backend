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
const idEquals = (left, right) =>
  String(objectIdOf(left)) === String(objectIdOf(right));

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

const isRemovedForAdmin = (vehicle, adminId) =>
  (vehicle.removedForAdmins || []).some((id) => idEquals(id, adminId));

const adminIsLinked = (vehicle, adminId) => {
  if (isRemovedForAdmin(vehicle, adminId)) return false;
  return (
    idEquals(vehicle.createdBy, adminId) ||
    (vehicle.associatedAdmins || []).some((admin) =>
      idEquals(admin, adminId),
    )
  );
};

const getActiveAdminIds = (vehicle) => {
  const removedIds = new Set(
    (vehicle.removedForAdmins || []).map((id) => String(objectIdOf(id))),
  );
  const activeIds = new Set();

  for (const admin of vehicle.associatedAdmins || []) {
    const id = String(objectIdOf(admin));
    if (id && !removedIds.has(id)) activeIds.add(id);
  }

  const creatorId = String(objectIdOf(vehicle.createdBy) || "");
  if (creatorId && !removedIds.has(creatorId)) activeIds.add(creatorId);
  return activeIds;
};

const getRemovalPermission = ({ vehicle, user, referencedByPolicy = false }) => {
  const linked = adminIsLinked(vehicle, user._id);
  if (!linked) {
    return {
      canDelete: false,
      deletionMode: null,
      deleteDisabledReason: "This vehicle is not linked to your account.",
    };
  }

  const activeAdminCount = getActiveAdminIds(vehicle).size;
  const canPermanentlyDelete =
    getSourceType(vehicle) === "manual" &&
    activeAdminCount === 1 &&
    !referencedByPolicy;

  if (canPermanentlyDelete) {
    return {
      canDelete: true,
      deletionMode: "permanent",
      deleteDisabledReason: null,
    };
  }

  let retainedReason = "The vehicle will remain available to other associated admins.";
  if (getSourceType(vehicle) === "automatic") {
    retainedReason = "Automatically verified vehicles are retained in the database.";
  } else if (referencedByPolicy) {
    retainedReason = "The vehicle is retained because one or more policies reference it.";
  }

  return {
    canDelete: true,
    deletionMode: "unlink",
    deleteDisabledReason: null,
    retainedReason,
  };
};

const presentVehicle = (
  vehicle,
  user,
  { includeAssociatedSubAdmins = false, referencedByPolicy = false } = {},
) => {
  const plain = vehicle.toObject ? vehicle.toObject() : { ...vehicle };
  const isCreator = idEquals(plain.createdBy, user._id);
  const associatedSubAdmins = [];
  const seen = new Set();
  const removedIds = new Set(
    (plain.removedForAdmins || []).map((id) => String(objectIdOf(id))),
  );

  if (includeAssociatedSubAdmins) {
    for (const admin of plain.associatedAdmins || []) {
      if (!admin || admin.role !== "Sub Admin") continue;
      const id = String(objectIdOf(admin));
      if (!id || seen.has(id) || removedIds.has(id)) continue;
      seen.add(id);
      associatedSubAdmins.push({
        _id: objectIdOf(admin),
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        isCreator: idEquals(plain.createdBy, admin),
      });
    }

    if (plain.createdBy?.role === "Sub Admin") {
      const creatorId = String(objectIdOf(plain.createdBy));
      if (!seen.has(creatorId) && !removedIds.has(creatorId)) {
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
    isLinkedToCurrentAdmin: adminIsLinked(plain, user._id),
    activeAdminCount: getActiveAdminIds(plain).size,
    permissions: getRemovalPermission({
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
    delete result.removedForAdmins;
  }

  return result;
};

const getPopulatedVehicle = (id) =>
  Vehicle.findById(id)
    .populate("createdBy", "fullName role email")
    .populate("associatedAdmins", "fullName role email");

const restoreAdminLink = async (vehicle, adminId) => {
  vehicle.associatedAdmins.addToSet(adminId);
  vehicle.removedForAdmins.pull(adminId);
  await vehicle.save();
};

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
        if (!adminIsLinked(existingVehicle, req.user._id)) {
          await restoreAdminLink(existingVehicle, req.user._id);
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

      const shouldAssociate = req.query.associate !== "false";
      if (shouldAssociate && !adminIsLinked(vehicle, req.user._id)) {
        await restoreAdminLink(vehicle, req.user._id);
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
              $and: [
                {
                  $or: [
                    { createdBy: req.user._id },
                    { associatedAdmins: req.user._id },
                  ],
                },
                { removedForAdmins: { $ne: req.user._id } },
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
        !adminIsLinked(vehicle, req.user._id)
      ) {
        return res.status(403).json({
          message: "Forbidden: This vehicle is not linked to your account.",
        });
      }

      if (req.body.registration !== undefined) {
        const cleanedRegistration = cleanRegistration(req.body.registration);
        const duplicate = await findVehicleByRegistration(cleanedRegistration);
        if (duplicate && !idEquals(duplicate._id, vehicle._id)) {
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
      updatePayload.lookupSource =
        wasAutomaticallySourced || incomingAutomaticData
          ? "regcheck"
          : "manual";

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

      if (!adminIsLinked(vehicle, req.user._id)) {
        return res.status(403).json({
          message: "This vehicle is not linked to your account.",
        });
      }

      const referencedByPolicy = Boolean(
        await Policy.exists({ vehicleId: vehicle._id }),
      );
      const sourceType = getSourceType(vehicle);
      const activeAdminCount = getActiveAdminIds(vehicle).size;
      const canPermanentlyDelete =
        sourceType === "manual" &&
        activeAdminCount === 1 &&
        !referencedByPolicy;

      if (canPermanentlyDelete) {
        await Vehicle.deleteOne({ _id: vehicle._id });
        return res.status(200).json({
          success: true,
          action: "deleted",
          message: "Vehicle deleted permanently because no other admin or policy uses it.",
        });
      }

      vehicle.associatedAdmins.pull(req.user._id);
      vehicle.removedForAdmins.addToSet(req.user._id);
      await vehicle.save();

      let retainedReason = "other admins are still associated with it";
      if (sourceType === "automatic") {
        retainedReason = "automatically verified vehicles are never removed from the database";
      } else if (referencedByPolicy) {
        retainedReason = "one or more policies reference it";
      }

      return res.status(200).json({
        success: true,
        action: "unlinked",
        message: `Vehicle removed from your account. It remains in the database because ${retainedReason}.`,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Server error while removing vehicle.",
        error: error.message,
      });
    }
  },
);

module.exports = router;
