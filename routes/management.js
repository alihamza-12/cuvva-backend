const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Policy = require("../models/Policy");
const AuditLog = require("../models/AuditLog");
const NotificationDelivery = require("../models/NotificationDelivery");
const CustomerVehicleHistory = require("../models/CustomerVehicleHistory");
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
        .populate("suspendedBy", "fullName email role")
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
      const { status, suspensionDays } = req.body;

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

      if (status === "Suspended" && targetUser.role === "Customer") {
        const days = Number(suspensionDays);
        if (!Number.isInteger(days) || days < 1 || days > 3650) {
          return res.status(400).json({
            message: "Choose a suspension duration between 1 and 3650 days.",
          });
        }
        targetUser.status = "Suspended";
        targetUser.suspendedAt = new Date();
        targetUser.suspendedUntil = new Date(
          Date.now() + days * 24 * 60 * 60 * 1000,
        );
        targetUser.suspendedBy = req.user._id;
      } else if (status === "Active") {
        targetUser.status = "Active";
        targetUser.suspendedAt = null;
        targetUser.suspendedUntil = null;
        targetUser.suspendedBy = null;
      } else {
        targetUser.status = status;
      }
      await targetUser.save();
      await targetUser.populate("suspendedBy", "fullName email role");

      res.status(200).json({
        success: true,
        message: `${targetUser.role} account (${targetUser.email}) status successfully updated to '${status}' by ${req.user.role}.`,
        user: {
          id: targetUser._id,
          fullName: targetUser.fullName,
          email: targetUser.email,
          role: targetUser.role,
          status: targetUser.status,
          suspendedAt: targetUser.suspendedAt,
          suspendedUntil: targetUser.suspendedUntil,
          suspendedBy: targetUser.suspendedBy,
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

/*
 * Permanently delete a customer (Super Admin only).
 *
 * A customer cannot be removed on its own: their policies reference them, and
 * those policies carry the only customer -> vehicle link in the system. So the
 * cascade is:
 *
 *   1. archive every customer -> vehicle pair from their policies
 *   2. delete their notification delivery rows
 *   3. delete their policies
 *   4. write an audit entry
 *   5. delete the customer
 *
 * Only accounts with role "Customer" can be removed here, so an admin account
 * can never be deleted through this endpoint by mistake.
 */
router.delete(
  "/customers/:id",
  verifyJWT,
  authorizeRoles("Super Admin"),
  async (req, res, next) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid customer id." });
      }

      const customer = await User.findById(req.params.id);
      if (!customer) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found." });
      }

      if (customer.role !== "Customer") {
        return res.status(400).json({
          success: false,
          message: "Only customer accounts can be deleted from here.",
        });
      }

      const policies = await Policy.find({ customerId: customer._id }).select(
        "_id policyNumber vehicleId endDate",
      );

      // 1. Keep the vehicle links alive for reporting/history.
      for (const policy of policies) {
        if (!policy.vehicleId) continue;
        try {
          await CustomerVehicleHistory.updateOne(
            { customerId: customer._id, vehicleId: policy.vehicleId },
            {
              $inc: { policyCount: 1 },
              $max: { lastUsedAt: policy.endDate || new Date() },
              $set: { lastPolicyNumber: policy.policyNumber || null },
            },
            { upsert: true },
          );
        } catch (archiveError) {
          console.error(
            "[management:deleteCustomer] archive failed:",
            archiveError.message,
          );
          return res.status(500).json({
            success: false,
            message:
              "Could not archive this customer's vehicle history, so nothing was deleted.",
          });
        }
      }

      const policyIds = policies.map((policy) => policy._id);

      // 2 + 3. Remove notifications, then the policies themselves.
      if (policyIds.length) {
        await NotificationDelivery.deleteMany({ policyId: { $in: policyIds } });
        await Policy.deleteMany({ _id: { $in: policyIds } });
      }

      // 4. Audit before the record disappears.
      await AuditLog.create({
        actorId: req.user._id,
        actorRole: req.user.role,
        actorEmail: req.user.email,
        action: "CUSTOMER_DELETED",
        module: "management",
        targetId: String(customer._id),
        success: true,
        payloadBefore: {
          fullName: customer.fullName,
          email: customer.email,
          policiesDeleted: policyIds.length,
          reason: "manual:super-admin-dashboard",
        },
      });

      // 5. Finally the customer.
      await User.deleteOne({ _id: customer._id });

      return res.status(200).json({
        success: true,
        message: `Customer ${customer.fullName} and ${policyIds.length} related ${
          policyIds.length === 1 ? "policy" : "policies"
        } deleted permanently.`,
        policiesDeleted: policyIds.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
