const express = require("express");
const router = express.Router();
const Policy = require("../models/Policy");
const Vehicle = require("../models/Vehicle");
const User = require("../models/User");

// --- Auth Middleware Import ---
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

// --- Route 1: Issue a New Policy (Admin/Broker Space) ---
/**
 * @route   POST /api/policies
 * @desc    Super Admins/Sub Admins manually issue a short-term coverage contract
 * @access  Private (Admin/Sub-Admin Only)
 */
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

      // 1. Verify that the target customer profile exists and is a Customer
      const targetCustomer = await User.findById(customerId);
      if (!targetCustomer || targetCustomer.role !== "Customer") {
        return res.status(404).json({
          success: false,
          message:
            "Invalid Customer ID. The assigned user record must hold the Customer role.",
        });
      }

      // 2. Verify that the vehicle asset exists in our local registry
      const targetVehicle = await Vehicle.findById(vehicleId);
      if (!targetVehicle) {
        return res.status(404).json({
          success: false,
          message:
            "Target vehicle not found in the system catalog. Register the car first.",
        });
      }

      // ========================================================
      // 🛡️ TIMELINE OVERLAP & DUPLICATE PREVENTION (TIMESTAMP BASED)
      // ========================================================

      // Normalize incoming inputs into clean ISO-date chunks to eliminate local timezone shifts
      const cleanIncomingStartDate = startDate.split("T")[0];
      const cleanIncomingEndDate = endDate.split("T")[0];

      // Build absolute, comparable UNIX timestamps forced into UTC ('Z')
      const incomingStartTimestamp = new Date(
        `${cleanIncomingStartDate}T${startTime}:00.000Z`,
      ).getTime();
      const incomingEndTimestamp = new Date(
        `${cleanIncomingEndDate}T${endTime}:00.000Z`,
      ).getTime();

      // Guard check: Prevent reversed timeline inputs
      if (incomingStartTimestamp >= incomingEndTimestamp) {
        return res.status(400).json({
          success: false,
          message:
            "Validation Error: Policy end time must be later than the start time.",
        });
      }

      // Query database for ANY valid active/upcoming policies affecting EITHER this car OR this driver
      const existingConflicts = await Policy.find({
        $or: [{ vehicleId: vehicleId }, { customerId: customerId }],
        status: { $in: ["Upcoming", "Active"] },
      });

      // Loop over existing entries and evaluate timeline collisions
      for (const policy of existingConflicts) {
        // Cleanly isolate database dates to ISO formatting strings
        const dbStartDateStr = new Date(policy.startDate)
          .toISOString()
          .split("T")[0];
        const dbEndDateStr = new Date(policy.endDate)
          .toISOString()
          .split("T")[0];

        // Parse database values to matching absolute timestamps
        const existingStartTimestamp = new Date(
          `${dbStartDateStr}T${policy.startTime}:00.000Z`,
        ).getTime();
        const existingEndTimestamp = new Date(
          `${dbEndDateStr}T${policy.endTime}:00.000Z`,
        ).getTime();

        // Standard Intersection Formula: (StartA < EndB) && (EndA > StartB)
        const isOverlapping =
          incomingStartTimestamp < existingEndTimestamp &&
          incomingEndTimestamp > existingStartTimestamp;

        if (isOverlapping) {
          // Identify precisely what caused the timeline block for custom client reporting
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

      // ========================================================
      // 📝 COMMIT CREATION (EXECUTES ONLY IF TIMELINE IS CLEAR)
      // ========================================================
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
        createdBy: req.user._id, // Capture working Admin/Sub-Admin account session tracking
      });

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

// --- Route 2: Get All Policies (Super Admin Operational Feed) ---
/**
 * @route   GET /api/policies/all
 * @desc    Returns a master list of all policy contracts across the platform with full relations
 * @access  Private (Super Admin Only)
 */
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

// --- Route 3: Get My Policies (Role-Based Ownership & Dynamic Population) ---
/**
 * @route   GET /api/policies/my
 * @desc    Returns a list of policies belonging to or managed by the logged-in user
 * @access  Private (Customer and Sub Admin Only)
 */
router.get("/my", authorizeRoles("Customer", "Sub Admin"), async (req, res) => {
  try {
    let filter = {};
    let populateCreatedByFields = "";

    // 🛡️ ROLE-BASED FILTERING & VISIBILITY CONFIGURATION
    if (req.user.role === "Customer") {
      // 1. Customers only see their own policies
      filter = { customerId: req.user._id };
      // 2. Customers only see the creator's Name and Email
      populateCreatedByFields = "fullName email";
    } else if (req.user.role === "Sub Admin") {
      // 1. Sub Admins only see policies they personally created
      filter = { createdBy: req.user._id };
      // 2. Sub Admins see full details of the creator (Name, Email, and Role)
      populateCreatedByFields = "fullName email role";
    }

    // Execute query with dynamic population rules
    const policies = await Policy.find(filter)
      .populate("vehicleId", "registration make model colour")
      .populate("customerId", "fullName email")
      .populate("createdBy", populateCreatedByFields) // 🔄 Dynamically populates based on role!
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
});

module.exports = router;
