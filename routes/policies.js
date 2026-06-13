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

      // 3. FRAUD & OVERLAP PREVENTION CHECK
      const overlappingPolicy = await Policy.findOne({
        vehicleId,
        status: "Active",
      });

      if (overlappingPolicy) {
        return res.status(400).json({
          success: false,
          message:
            "Conflict Error: This vehicle is currently covered under an active session by another user. New coverage can only be issued or scheduled after their active window expires.",
        });
      }

      // 4. Create and compile the policy transaction document
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
        createdBy: req.user._id, // Capture the working Broker/Admin ID from verifyJWT session
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
