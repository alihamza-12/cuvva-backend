const express = require("express");
const mongoose = require("mongoose");
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

router.get(
  "/subadmins/:id/policy-permissions",
  verifyJWT,
  authorizeRoles("Super Admin"),
  async (req, res, next) => {
    try {
      const subAdmin = await User.findOne({
        _id: req.params.id,
        role: "Sub Admin",
      }).select("fullName email role status policyRestrictedCustomerIds");

      if (!subAdmin) {
        return res.status(404).json({ message: "Sub Admin not found." });
      }

      const restrictedIds = new Set(
        (subAdmin.policyRestrictedCustomerIds || []).map((customerId) =>
          customerId.toString(),
        ),
      );

      const customerDocuments = await User.find({
        role: "Customer",
        createdBy: subAdmin._id,
      })
        .select("fullName email status createdAt")
        .sort({ createdAt: -1 });

      const customers = customerDocuments.map((customerDocument) => ({
        ...customerDocument.toObject(),
        policyCreationRestricted: restrictedIds.has(
          customerDocument._id.toString(),
        ),
      }));

      return res.status(200).json({
        success: true,
        subAdmin: {
          _id: subAdmin._id,
          fullName: subAdmin.fullName,
          email: subAdmin.email,
          status: subAdmin.status,
        },
        count: customers.length,
        restrictedCount: customers.filter(
          (customer) => customer.policyCreationRestricted,
        ).length,
        customers,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/subadmins/:id/policy-permissions",
  verifyJWT,
  authorizeRoles("Super Admin"),
  async (req, res, next) => {
    try {
      const { customerIds, restricted } = req.body || {};

      if (!Array.isArray(customerIds) || customerIds.length === 0) {
        return res.status(400).json({
          message: "Select at least one customer.",
        });
      }

      if (typeof restricted !== "boolean") {
        return res.status(400).json({
          message: "The restricted value must be true or false.",
        });
      }

      const uniqueCustomerIds = [...new Set(customerIds.map(String))];

      if (
        !mongoose.isValidObjectId(req.params.id) ||
        uniqueCustomerIds.some(
          (customerId) => !mongoose.isValidObjectId(customerId),
        )
      ) {
        return res.status(400).json({ message: "Invalid account identifier." });
      }

      const subAdmin = await User.findOne({
        _id: req.params.id,
        role: "Sub Admin",
      });

      if (!subAdmin) {
        return res.status(404).json({ message: "Sub Admin not found." });
      }

      const ownedCustomers = await User.find({
        _id: { $in: uniqueCustomerIds },
        role: "Customer",
        createdBy: subAdmin._id,
      }).select("_id");

      if (ownedCustomers.length !== uniqueCustomerIds.length) {
        return res.status(403).json({
          message:
            "One or more selected customers do not belong to this Sub Admin.",
        });
      }

      if (restricted) {
        await User.updateOne(
          { _id: subAdmin._id },
          {
            $addToSet: {
              policyRestrictedCustomerIds: { $each: uniqueCustomerIds },
            },
          },
        );
      } else {
        await User.updateOne(
          { _id: subAdmin._id },
          {
            $pull: {
              policyRestrictedCustomerIds: { $in: uniqueCustomerIds },
            },
          },
        );
      }

      const updatedSubAdmin = await User.findById(subAdmin._id).select(
        "policyRestrictedCustomerIds",
      );
      const restrictedIds = new Set(
        (updatedSubAdmin.policyRestrictedCustomerIds || []).map((customerId) =>
          customerId.toString(),
        ),
      );

      const customerDocuments = await User.find({
        role: "Customer",
        createdBy: subAdmin._id,
      })
        .select("fullName email status createdAt")
        .sort({ createdAt: -1 });

      const customers = customerDocuments.map((customerDocument) => ({
        ...customerDocument.toObject(),
        policyCreationRestricted: restrictedIds.has(
          customerDocument._id.toString(),
        ),
      }));

      return res.status(200).json({
        success: true,
        message: restricted
          ? `${uniqueCustomerIds.length} customer(s) restricted from policy creation.`
          : `${uniqueCustomerIds.length} customer(s) allowed for policy creation.`,
        count: customers.length,
        restrictedCount: customers.filter(
          (customer) => customer.policyCreationRestricted,
        ).length,
        customers,
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
