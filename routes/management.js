const express = require("express");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const router = express.Router();

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

router.patch(
  "/status/:id",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !["Active", "Suspended"].includes(status)) {
        return res.status(400).json({
          message:
            "Invalid status value. Payload parameter must match 'Active' or 'Suspended'.",
        });
      }

      const targetUser = await User.findById(id);
      if (!targetUser) {
        return res.status(404).json({
          message: "Operational Error: Target account profile not found.",
        });
      }

      if (targetUser.role === "Super Admin") {
        return res.status(403).json({
          message:
            "Forbidden: Super Admin status settings are structurally permanent.",
        });
      }

      if (req.user.role === "Sub Admin") {

        if (targetUser.role !== "Customer") {
          return res.status(403).json({
            message:
              "Forbidden Security Boundary: Sub Admins do not possess clearance levels to alter management accounts.",
          });
        }

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
      next(error); 
    }
  },
);

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

        targetUser.password = password;
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
