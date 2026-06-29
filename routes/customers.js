const express = require("express");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const router = express.Router();

// =========================================================================
// @route   GET /api/customers
// @desc    Get Customers List (Super Admin gets all, Sub Admin gets only theirs)
// @access  Protected (Super Admin & Sub Admin Only)
// =========================================================================
router.get(
  "/",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      let queryFilter = { role: "Customer" };

      // RULE ENFORCEMENT: If the logged-in user is a Sub Admin, restrict findings to their own created clients
      if (req.user.role === "Sub Admin") {
        queryFilter.createdBy = req.user._id;
      }

      // Execute query and populate creator info (only pulling non-sensitive tracking fields)
      const customers = await User.find(queryFilter)
        .populate("createdBy", "fullName email role")
        .select("-password -refreshTokens") // Clean payload protection
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        count: customers.length,
        customers,
      });
    } catch (error) {
      next(error); // Passes execution smoothly to your centralized error handler in app.js
    }
  },
);

// =========================================================================
// @route   GET /api/customers/:id
// @desc    Get Single Customer Detail with populated ownership metadata
// @access  Protected (Super Admin & Sub Admin Only)
// =========================================================================
router.get(
  "/:id",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      const customer = await User.findOne({
        _id: req.id || req.params.id,
        role: "Customer",
      })
        .populate("createdBy", "fullName email role")
        .select("-password -refreshTokens");

      if (!customer) {
        return res.status(404).json({ message: "Customer account not found" });
      }

      // SECURITY GUARD: Prevent a Sub Admin from viewing a customer they did not create
      if (
        req.user.role === "Sub Admin" &&
        customer.createdBy &&
        customer.createdBy._id.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          message:
            "Forbidden: You do not have permission to view this sub-account client record.",
        });
      }

      res.status(200).json({
        success: true,
        customer,
      });
    } catch (error) {
      next(error);
    }
  },
);

// =========================================================================
// @route   PATCH /api/customers/:id
// @desc    Update full Customer profile (Sub Admin with ownership guard, Super Admin allowed)
// @access  Protected (Super Admin & Sub Admin Only)
// =========================================================================
router.patch(
  "/:id",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { fullName, email, expiresAt, password } = req.body || {};

      if (
        !fullName &&
        !email &&
        expiresAt === undefined &&
        password === undefined
      ) {
        return res.status(400).json({ message: "No update fields provided." });
      }

      const targetUser = await User.findById(id);
      if (!targetUser) {
        return res.status(404).json({ message: "Customer account not found" });
      }

      if (targetUser.role !== "Customer") {
        return res.status(403).json({ message: "Forbidden: Not a Customer." });
      }

      // Sub Admin ownership guard: can only modify customers they created
      if (req.user.role === "Sub Admin") {
        if (
          !targetUser.createdBy ||
          targetUser.createdBy.toString() !== req.user._id.toString()
        ) {
          return res.status(403).json({
            message:
              "Forbidden: You do not have permission to update this customer.",
          });
        }
      }

      if (typeof fullName === "string" && fullName.trim()) {
        targetUser.fullName = fullName.trim();
      }

      if (typeof email === "string" && email.trim()) {
        targetUser.email = email.toLowerCase().trim();
      }

      if (expiresAt !== undefined) {
        targetUser.expiresAt = expiresAt ? new Date(expiresAt) : null;
      }

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
        customer: {
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
