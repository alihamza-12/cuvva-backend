const express = require("express");
const router = express.Router();
const Policy = require("../models/Policy");
const Vehicle = require("../models/Vehicle");
const User = require("../models/User");

const { sendPolicyEmail } = require("../utils/sendEmail");

const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

router.post(
  "/",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      const {
        customerId,
        vehicleId,
        premiumAmount,
        startDate,
        endDate,
        startTime,
        endTime,
        policyType,
        coverageType,
        underwriter,
        internalNotes,
      } = req.body;

      const targetCustomer = await User.findById(customerId);
      if (!targetCustomer || targetCustomer.role !== "Customer") {
        return res.status(404).json({
          success: false,
          message:
            "Invalid Customer ID. The assigned user record must hold the Customer role.",
        });
      }

      const targetVehicle = await Vehicle.findById(vehicleId);
      if (!targetVehicle) {
        return res.status(404).json({
          success: false,
          message:
            "Target vehicle not found in the system catalog. Register the car first.",
        });
      }

      const cleanIncomingStartDate = startDate.split("T")[0];
      const cleanIncomingEndDate = endDate.split("T")[0];

      const incomingStartTimestamp = new Date(
        `${cleanIncomingStartDate}T${startTime}:00.000Z`,
      ).getTime();
      const incomingEndTimestamp = new Date(
        `${cleanIncomingEndDate}T${endTime}:00.000Z`,
      ).getTime();

      if (incomingStartTimestamp >= incomingEndTimestamp) {
        return res.status(400).json({
          success: false,
          message:
            "Validation Error: Policy end time must be later than the start time.",
        });
      }

      const existingConflicts = await Policy.find({
        $or: [{ vehicleId: vehicleId }, { customerId: customerId }],
        status: { $in: ["Upcoming", "Active"] },
      });

      for (const policy of existingConflicts) {

        const dbStartDateStr = new Date(policy.startDate)
          .toISOString()
          .split("T")[0];
        const dbEndDateStr = new Date(policy.endDate)
          .toISOString()
          .split("T")[0];

        const existingStartTimestamp = new Date(
          `${dbStartDateStr}T${policy.startTime}:00.000Z`,
        ).getTime();
        const existingEndTimestamp = new Date(
          `${dbEndDateStr}T${policy.endTime}:00.000Z`,
        ).getTime();

        const isOverlapping =
          incomingStartTimestamp < existingEndTimestamp &&
          incomingEndTimestamp > existingStartTimestamp;

        if (isOverlapping) {

          const conflictTarget =
            policy.vehicleId.toString() === vehicleId
              ? "This vehicle is already covered under an active/upcoming session"
              : "This customer already has an active/upcoming insurance window scheduled";

          return res.status(400).json({
            success: false,
            message: `Conflict Error: ${conflictTarget} under policy (${policy.policyNumber}) from ${policy.startTime} to ${policy.endTime} on this date range.`,
          });
        }
      }

      const newPolicy = await Policy.create({
        customerId,
        vehicleId,
        premiumAmount,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        startTime,
        endTime,
        policyType,
        coverageType,
        underwriter,
        internalNotes,
        createdBy: req.user._id, 
      });

      try {

        const emailData = {
          customerFullName: targetCustomer.fullName || "Valued Customer",
          customerFirstName: (targetCustomer.fullName || "there").split(" ")[0],
          vehicleMake: targetVehicle.make,
          vehicleModel: targetVehicle.model,
          registration: targetVehicle.registration,

          startDateStr: new Date(newPolicy.startDate).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          }),
          endDateStr: new Date(newPolicy.endDate).toLocaleString("en-GB", {
            hour: "numeric",
            minute: "2-digit",
          }),
          duration: "1 hour", 
          price: Number(newPolicy.premiumAmount).toFixed(2), 
          cardBrand: "Card",
          cardLast4: "0000", 
          policyNumber: newPolicy.policyNumber || newPolicy._id.toString(),
        };

        sendPolicyEmail(targetCustomer.email, emailData);
      } catch (emailError) {

        console.error("Failed to send policy email:", emailError);
      }

      return res.status(201).json({
        success: true,
        message: "Insurance policy transaction executed successfully.",
        policy: newPolicy,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Server error during insurance policy creation.",
        error: err.message,
      });
    }
  },
);

router.get(
  "/all",
  verifyJWT,
  authorizeRoles("Super Admin"),
  async (req, res) => {
    try {
      const policies = await Policy.find()
        .populate("customerId", "fullName email role")
        .populate("vehicleId", "registration make model colour")
        .populate("createdBy", "fullName role")
        .sort({ createdAt: -1 });

      return res.status(200).json({
        success: true,
        count: policies.length,
        policies,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Server error fetching global policy collection.",
        error: err.message,
      });
    }
  },
);

router.get(
  "/my",
  authorizeRoles("Customer", "Sub Admin", "Super Admin"), 
  async (req, res) => {
    try {
      let filter = {};
      let populateCreatedByFields = "";

      if (req.user.role === "Customer") {

        filter = { customerId: req.user._id };

        populateCreatedByFields = "fullName email";
      } else if (
        req.user.role === "Sub Admin" ||
        req.user.role === "Super Admin"
      ) {

        filter = { createdBy: req.user._id };

        populateCreatedByFields = "fullName email role";
      }

      const policies = await Policy.find(filter)
        .populate("vehicleId", "registration make model colour")
        .populate("customerId", "fullName email")
        .populate("createdBy", populateCreatedByFields) 
        .sort({ createdAt: -1 });

      return res.status(200).json({
        success: true,
        count: policies.length,
        policies,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Server error while retrieving your policy records.",
        error: err.message,
      });
    }
  },
);

router.get(
  "/:id",
  verifyJWT,
  authorizeRoles("Super Admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const policy = await Policy.findById(id)
        .populate("customerId", "fullName email role")
        .populate("vehicleId", "registration make model colour")
        .populate("createdBy", "fullName role");

      if (!policy) {
        return res.status(404).json({
          success: false,
          message: "Policy not found.",
        });
      }

      return res.status(200).json({
        success: true,
        policy,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Server error fetching policy detail.",
        error: err.message,
      });
    }
  },
);

router.put(
  "/:id",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        premiumAmount,
        startDate,
        endDate,
        startTime,
        endTime,
        policyType,
        coverageType,
        underwriter,
        status,
        internalNotes,
      } = req.body;

      const policy = await Policy.findById(id);
      if (!policy) {
        return res.status(404).json({
          success: false,
          message: "Policy not found.",
        });
      }

      if (req.user.role === "Sub Admin") {
        if (policy.createdBy.toString() !== req.user._id.toString()) {
          return res.status(403).json({
            success: false,
            message: "Forbidden: you can only update policies you created.",
          });
        }
      }

      if (startDate && endDate && startTime && endTime) {
        const cleanIncomingStartDate = startDate.split("T")[0];
        const cleanIncomingEndDate = endDate.split("T")[0];

        const incomingStartTimestamp = new Date(
          `${cleanIncomingStartDate}T${startTime}:00.000Z`,
        ).getTime();
        const incomingEndTimestamp = new Date(
          `${cleanIncomingEndDate}T${endTime}:00.000Z`,
        ).getTime();

        if (incomingStartTimestamp >= incomingEndTimestamp) {
          return res.status(400).json({
            success: false,
            message:
              "Validation Error: Policy end time must be later than the start time.",
          });
        }

        const existingConflicts = await Policy.find({
          _id: { $ne: id },
          $or: [
            { vehicleId: policy.vehicleId },
            { customerId: policy.customerId },
          ],
          status: { $in: ["Upcoming", "Active"] },
        });

        for (const existing of existingConflicts) {
          const dbStartDateStr = new Date(existing.startDate)
            .toISOString()
            .split("T")[0];
          const dbEndDateStr = new Date(existing.endDate)
            .toISOString()
            .split("T")[0];

          const existingStartTimestamp = new Date(
            `${dbStartDateStr}T${existing.startTime}:00.000Z`,
          ).getTime();
          const existingEndTimestamp = new Date(
            `${dbEndDateStr}T${existing.endTime}:00.000Z`,
          ).getTime();

          const isOverlapping =
            incomingStartTimestamp < existingEndTimestamp &&
            incomingEndTimestamp > existingStartTimestamp;

          if (isOverlapping) {
            return res.status(400).json({
              success: false,
              message: `Conflict Error: overlapping with policy (${existing.policyNumber}).`,
            });
          }
        }
      }

      if (premiumAmount !== undefined) policy.premiumAmount = premiumAmount;
      if (startDate !== undefined) policy.startDate = new Date(startDate);
      if (endDate !== undefined) policy.endDate = new Date(endDate);
      if (startTime !== undefined) policy.startTime = startTime;
      if (endTime !== undefined) policy.endTime = endTime;
      if (policyType !== undefined) policy.policyType = policyType;
      if (coverageType !== undefined) policy.coverageType = coverageType;
      if (underwriter !== undefined) policy.underwriter = underwriter;
      if (status !== undefined) policy.status = status;
      if (internalNotes !== undefined) policy.internalNotes = internalNotes;

      await policy.save();

      const updated = await Policy.findById(id)
        .populate("customerId", "fullName email role")
        .populate("vehicleId", "registration make model colour")
        .populate("createdBy", "fullName role");

      return res.status(200).json({
        success: true,
        message: "Insurance policy updated successfully.",
        policy: updated,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Server error while updating insurance policy.",
        error: err.message,
      });
    }
  },
);

module.exports = router;
