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
  }
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
      const customer = await User.findOne({ _id: req.id || req.params.id, role: "Customer" })
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
          message: "Forbidden: You do not have permission to view this sub-account client record.",
        });
      }

      res.status(200).json({
        success: true,
        customer,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;