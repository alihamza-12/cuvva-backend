const express = require("express");
const router = express.Router();
const Policy = require("../models/Policy");
const Vehicle = require("../models/Vehicle");
const User = require("../models/User");

const { sendPolicyEmail } = require("../utils/sendEmail");
const {
  generatePolicyCertificatePdf,
  buildDocumentData,
} = require("../services/pdf/generatePolicyCertificate");
const { normalizeTime } = require("../utils/normalizeTime");

const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const formatEmailPolicyDateTime = (dateValue, timeValue) => {
  const date = new Date(dateValue);
  const normalizedTime = String(timeValue || "00:00").padStart(5, "0");
  const [hoursValue, minutesValue] = normalizedTime.split(":").map(Number);

  if (
    Number.isNaN(date.getTime()) ||
    !Number.isInteger(hoursValue) ||
    !Number.isInteger(minutesValue)
  ) {
    return "N/A";
  }

  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  const day = date.getUTCDate();
  const hour12 = hoursValue % 12 || 12;
  const minutes = minutesValue === 0
    ? ""
    : `:${String(minutesValue).padStart(2, "0")}`;
  const period = hoursValue >= 12 ? "pm" : "am";

  return `${weekday} ${day} ${month} at ${hour12}${minutes}${period}`;
};

const formatPolicyDuration = (startTimestamp, endTimestamp) => {
  // Policy end times represent the final covered minute (for example,
  // 10:59 means cover continues until 10:59:59).
  const totalMinutes = Math.max(
    1,
    Math.round((endTimestamp - startTimestamp) / 60000) + 1,
  );
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  return [
    days ? `${days} day${days === 1 ? "" : "s"}` : "",
    hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "",
    minutes ? `${minutes} minute${minutes === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

router.post(
  "/",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      let {
        customerId,
        vehicleId,
        premiumAmount,
        excess,
        startDate,
        endDate,
        startTime,
        endTime,
        policyType,
        coverageType,
        underwriter,
        internalNotes,
      } = req.body;

      const normalizedStartTime = normalizeTime(startTime);
      const normalizedEndTime = normalizeTime(endTime);

      if (normalizedStartTime === null || normalizedEndTime === null) {
        return res.status(400).json({
          success: false,
          message:
            "Validation Error: Enter a valid time (e.g. 09:30 or 5 PM).",
        });
      }

      startTime = normalizedStartTime;
      endTime = normalizedEndTime;

      const targetCustomer = await User.findById(customerId);
      if (!targetCustomer || targetCustomer.role !== "Customer") {
        return res.status(404).json({
          success: false,
          message:
            "Invalid Customer ID. The assigned user record must hold the Customer role.",
        });
      }

      if (req.user.role === "Sub Admin") {
        const ownsCustomer =
          targetCustomer.createdBy &&
          targetCustomer.createdBy.toString() === req.user._id.toString();

        if (!ownsCustomer) {
          return res.status(403).json({
            success: false,
            message:
              "Forbidden: You can only create policies for customers you created.",
          });
        }

        const isCustomerRestricted = (
          req.user.policyRestrictedCustomerIds || []
        ).some(
          (restrictedId) => restrictedId.toString() === String(customerId),
        );

        if (isCustomerRestricted) {
          return res.status(403).json({
            success: false,
            message:
              "Policy creation has been restricted for this customer by a Super Admin.",
          });
        }
      }

      const targetVehicle = await Vehicle.findById(vehicleId);
      if (!targetVehicle) {
        return res.status(404).json({
          success: false,
          message:
            "Target vehicle not found in the system catalog. Register the car first.",
        });
      }

      if (
        req.user.role === "Sub Admin" &&
        targetVehicle.createdBy.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Forbidden: You can only create policies using vehicles you created.",
        });
      }

      const missingLegalFields = [];
      if (!targetCustomer.fullName?.trim()) missingLegalFields.push("customer name");
      if (!targetCustomer.dateOfBirth) missingLegalFields.push("customer birth date");
      if (!targetCustomer.drivingLicenceNumber?.trim()) {
        missingLegalFields.push("driving licence number");
      }
      if (!targetVehicle.registration?.trim()) {
        missingLegalFields.push("vehicle registration");
      }
      if (!targetVehicle.vehicleIdentificationNumber?.trim()) {
        missingLegalFields.push("vehicle VIN");
      }

      if (missingLegalFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot issue policy certificate. Complete the following required fields first: ${missingLegalFields.join(", ")}.`,
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
        excess: excess === undefined ? 500 : excess,
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
        const dynamicPolicyPdf = await generatePolicyCertificatePdf({
          policy: newPolicy,
          customer: targetCustomer,
          vehicle: targetVehicle,
        });

        const duration = formatPolicyDuration(
          incomingStartTimestamp,
          incomingEndTimestamp,
        );
        const customerFullName =
          [targetCustomer.firstName, targetCustomer.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() ||
          targetCustomer.fullName?.trim() ||
          "Valued Customer";

        const emailData = {
          customerFullName,
          customerFirstName: customerFullName.split(/\s+/)[0] || "there",
          vehicleMake: targetVehicle.make,
          vehicleModel: targetVehicle.model,
          registration: targetVehicle.registration,
          startDateStr: formatEmailPolicyDateTime(
            newPolicy.startDate,
            newPolicy.startTime,
          ),
          endDateStr: formatEmailPolicyDateTime(
            newPolicy.endDate,
            newPolicy.endTime,
          ),
          duration,
          price: Number(newPolicy.premiumAmount).toFixed(2),
          cardBrand: "Card",
          cardLast4: "0000",
          policyNumber: newPolicy.policyNumber || newPolicy._id.toString(),
          underwriter: newPolicy.underwriter,
        };

        sendPolicyEmail(
          targetCustomer.email,
          emailData,
          dynamicPolicyPdf,
        ).catch((emailError) => {
          console.error("Failed to send policy email:", emailError);
        });
      } catch (documentError) {
        console.error(
          "Failed to generate dynamic policy certificate:",
          documentError,
        );
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
  "/:id/document-data",
  verifyJWT,
  authorizeRoles("Customer", "Sub Admin", "Super Admin"),
  async (req, res) => {
    try {
      const policy = await Policy.findById(req.params.id);

      if (!policy) {
        return res.status(404).json({ message: "Policy not found." });
      }

      if (
        req.user.role === "Customer" &&
        String(policy.customerId) !== String(req.user._id)
      ) {
        return res.status(403).json({
          message: "Forbidden: You can only view documents for your policies.",
        });
      }

      if (
        req.user.role === "Sub Admin" &&
        String(policy.createdBy) !== String(req.user._id)
      ) {
        return res.status(403).json({
          message: "Forbidden: You can only view documents for policies you created.",
        });
      }

      const [customer, vehicle] = await Promise.all([
        User.findById(policy.customerId),
        Vehicle.findById(policy.vehicleId),
      ]);

      if (!customer || !vehicle) {
        return res.status(404).json({
          message: "The customer or vehicle for this policy no longer exists.",
        });
      }

      return res.status(200).json({
        success: true,
        document: buildDocumentData({ policy, customer, vehicle }),
      });
    } catch (error) {
      return res.status(500).json({
        message: "Failed to load the policy document.",
        error: error.message,
      });
    }
  },
);

router.get(
  "/:id/document",
  verifyJWT,
  authorizeRoles("Customer", "Sub Admin", "Super Admin"),
  async (req, res) => {
    try {
      const policy = await Policy.findById(req.params.id);

      if (!policy) {
        return res.status(404).json({ message: "Policy not found." });
      }

      if (
        req.user.role === "Customer" &&
        String(policy.customerId) !== String(req.user._id)
      ) {
        return res.status(403).json({
          message: "Forbidden: You can only view documents for your policies.",
        });
      }

      if (
        req.user.role === "Sub Admin" &&
        String(policy.createdBy) !== String(req.user._id)
      ) {
        return res.status(403).json({
          message: "Forbidden: You can only view documents for policies you created.",
        });
      }

      const [customer, vehicle] = await Promise.all([
        User.findById(policy.customerId),
        Vehicle.findById(policy.vehicleId),
      ]);

      if (!customer || !vehicle) {
        return res.status(404).json({
          message: "The customer or vehicle for this policy no longer exists.",
        });
      }

      const pdfBuffer = await generatePolicyCertificatePdf({
        policy,
        customer,
        vehicle,
      });
      const safePolicyNumber = String(
        policy.policyNumber || policy._id,
      ).replace(/[^a-zA-Z0-9_-]/g, "-");

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${safePolicyNumber}-policy-details-and-certificate.pdf"`,
      );
      res.setHeader("Content-Length", pdfBuffer.length);
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");

      return res.status(200).send(pdfBuffer);
    } catch (error) {
      return res.status(500).json({
        message: "Failed to generate the policy document.",
        error: error.message,
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
        excess,
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

      const incomingStartTime =
        startTime !== undefined ? normalizeTime(startTime) : undefined;
      const incomingEndTime =
        endTime !== undefined ? normalizeTime(endTime) : undefined;

      if (
        (startTime !== undefined && incomingStartTime === null) ||
        (endTime !== undefined && incomingEndTime === null)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Validation Error: Enter a valid time (e.g. 09:30 or 5 PM).",
        });
      }
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
          `${cleanIncomingStartDate}T${incomingStartTime}:00.000Z`,
        ).getTime();
        const incomingEndTimestamp = new Date(
          `${cleanIncomingEndDate}T${incomingEndTime}:00.000Z`,
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
      if (excess !== undefined) policy.excess = excess;
      if (startDate !== undefined) policy.startDate = new Date(startDate);
      if (endDate !== undefined) policy.endDate = new Date(endDate);
      if (startTime !== undefined) policy.startTime = incomingStartTime;
      if (endTime !== undefined) policy.endTime = incomingEndTime;
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
