const express = require("express");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const router = express.Router();

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
        return res
          .status(404)
          .json({
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

module.exports = router;
