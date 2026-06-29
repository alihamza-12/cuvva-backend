const express = require("express");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const router = express.Router();

// ==========================================
// @route   GET /api/management/subadmins
// @desc    Get All Sub Admins across the platform
// @access  Protected (Super Admin Only)
// ==========================================
router.get(
  "/subadmins",
  verifyJWT,
  authorizeRoles("Super Admin"),
  async (req, res, next) => {
    try {
      const subAdmins = await User.find({ role: "Sub Admin" })
        .populate("createdBy", "fullName email")
        .select("-password -refreshTokens")
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        count: subAdmins.length,
        subAdmins,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ==========================================
// @route   GET /api/management/customers
// @desc    Get All Customers across the platform (Global overview with creator details)
// @access  Protected (Super Admin Only)
// ==========================================
router.get(
  "/customers",
  verifyJWT,
  authorizeRoles("Super Admin"),
  async (req, res, next) => {
    try {
      const customers = await User.find({ role: "Customer" })
        .populate("createdBy", "fullName email role")
        .select("-password -refreshTokens")
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        count: customers.length,
        customers,
      });
    } catch (error) {
      next(error);
    }
  },
);
// ==========================================
// @route   PATCH /api/management/status/:id
// @desc    Hierarchical Status Engine (Toggle 'Active' / 'Suspended' States)
// @access  Protected (Super Admin & Sub Admin Only)
// ==========================================
router.patch(
  "/status/:id",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      // 1. Validate status input against schema enum configurations
      if (!status || !["Active", "Suspended"].includes(status)) {
        return res.status(400).json({
          message:
            "Invalid status value. Payload parameter must match 'Active' or 'Suspended'.",
        });
      }

      // 2. Locate target user profile record in database cluster
      const targetUser = await User.findById(id);
      if (!targetUser) {
        return res.status(404).json({
          message: "Operational Error: Target account profile not found.",
        });
      }

      // 3. Absolute Protection Guard: Super Admin records can NEVER be modified by endpoints
      if (targetUser.role === "Super Admin") {
        return res.status(403).json({
          message:
            "Forbidden: Super Admin status settings are structurally permanent.",
        });
      }

      // ========================================================
      // 4. HIERARCHICAL PERMISSION MATRIX ENFORCEMENT ENGINE
      // ========================================================
      if (req.user.role === "Sub Admin") {
        // LIMITATION A: Sub Admins cannot modify other Sub Admins
        if (targetUser.role !== "Customer") {
          return res.status(403).json({
            message:
              "Forbidden Security Boundary: Sub Admins do not possess clearance levels to alter management accounts.",
          });
        }

        // LIMITATION B: Sub Admins can only modify customers they personally registered
        if (
          !targetUser.createdBy ||
          targetUser.createdBy.toString() !== req.user._id.toString()
        ) {
          return res.status(403).json({
            message:
              "Forbidden ownership fault: You are unauthorized to alter status rules for clients outside your tracking chain.",
          });
        }
      }

      // 5. Commit status update transition to the cluster document
      targetUser.status = status;
      await targetUser.save();

      res.status(200).json({
        success: true,
        message: `${targetUser.role} account (${targetUser.email}) status successfully updated to '${status}' by ${req.user.role}.`,
        user: {
          id: targetUser._id,
          fullName: targetUser.fullName,
          email: targetUser.email,
          role: targetUser.role,
          status: targetUser.status,
        },
      });
    } catch (error) {
      next(error); // Route pipeline failure smoothly into centralized error framework
    }
  },
);

// ==========================================
// @route   GET /api/management/subadmins/:id
// @desc    Get single Sub Admin by id
// @access  Protected (Super Admin Only)
// ==========================================
router.get(
  "/subadmins/:id",
  verifyJWT,
  authorizeRoles("Super Admin"),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const user = await User.findById(id)
        .populate("createdBy", "fullName email role")
        .select("-password -refreshTokens");

      if (!user) {
        return res.status(404).json({ message: "Sub Admin not found." });
      }

      if (user.role !== "Sub Admin") {
        return res.status(403).json({ message: "Forbidden: Not a Sub Admin." });
      }

      return res.status(200).json({ success: true, user });
    } catch (error) {
      next(error);
    }
  },
);

// ==========================================
// @route   PATCH /api/management/subadmins/:id
// @desc    Update full Sub Admin profile (Super Admin only)
// @access  Protected (Super Admin Only)
// ==========================================
router.patch(
  "/subadmins/:id",
  verifyJWT,
  authorizeRoles("Super Admin"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { fullName, email, expiresAt, password } = req.body || {};

      if (!fullName && !email && !expiresAt && !password) {
        return res.status(400).json({ message: "No update fields provided." });
      }

      const targetUser = await User.findById(id);
      if (!targetUser) {
        return res.status(404).json({ message: "Sub Admin not found." });
      }

      if (targetUser.role !== "Sub Admin") {
        return res.status(403).json({ message: "Forbidden: Not a Sub Admin." });
      }

      // Update basic fields (allow email if provided)
      if (typeof fullName === "string" && fullName.trim()) {
        targetUser.fullName = fullName.trim();
      }

      if (typeof email === "string" && email.trim()) {
        targetUser.email = email.toLowerCase().trim();
      }

      // Update expiry window (can be null to clear)
      if (expiresAt !== undefined) {
        targetUser.expiresAt = expiresAt ? new Date(expiresAt) : null;
      }

      // Optional password update
      if (password !== undefined) {
        if (typeof password !== "string" || password.trim().length < 6) {
          return res.status(400).json({
            message: "Password must be at least 6 characters.",
          });
        }

        const bcrypt = require("bcryptjs");
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        targetUser.password = hashedPassword;
      }

      await targetUser.save();

      return res.status(200).json({
        success: true,
        user: {
          id: targetUser._id,
          fullName: targetUser.fullName,
          email: targetUser.email,
          role: targetUser.role,
          status: targetUser.status,
          expiresAt: targetUser.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
