const express = require("express");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const router = express.Router();

router.get(
  "/me",
  (req, res, next) => {

    console.log("[customers:/me] cookies at entry:", req.cookies);
    next();
  },
  verifyJWT,
  authorizeRoles("Customer"),
  async (req, res, next) => {
    try {
      if (!req.user || req.user.role !== "Customer") {
        return res
          .status(403)
          .json({ message: "Forbidden: Customer access only" });
      }

      const customer = await User.findById(req.user._id)
        .select(
          "fullName email phone dateOfBirth gender drivingLicenceNumber role status expiresAt createdBy createdAt preferredName additionalEmails profilePhotoUrl",
        )
        .lean();

      if (!customer) {
        return res.status(404).json({ message: "Customer account not found" });
      }

      return res.status(200).json({
        success: true,
        customer,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/me",
  verifyJWT,
  authorizeRoles("Customer"),
  async (req, res, next) => {
    try {
      const { preferredName, additionalEmail, phone, profilePhotoUrl } =
        req.body || {};

      if (
        preferredName === undefined &&
        additionalEmail === undefined &&
        phone === undefined &&
        profilePhotoUrl === undefined
      ) {
        return res.status(400).json({ message: "No update fields provided." });
      }

      const customer = await User.findById(req.user._id);
      if (!customer) {
        return res.status(404).json({ message: "Customer account not found" });
      }

      if (preferredName !== undefined) {
        const trimmed =
          typeof preferredName === "string" ? preferredName.trim() : "";
        customer.preferredName = trimmed || null;
      }

      if (additionalEmail !== undefined) {
        const trimmedEmail =
          typeof additionalEmail === "string"
            ? additionalEmail.toLowerCase().trim()
            : "";

        if (!trimmedEmail) {
          return res
            .status(400)
            .json({ message: "Email address is required." });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedEmail)) {
          return res
            .status(400)
            .json({ message: "Please provide a valid email address." });
        }

        if (trimmedEmail === customer.email) {
          return res.status(400).json({
            message: "This is already your main email address.",
          });
        }

        if (
          customer.additionalEmails &&
          customer.additionalEmails.includes(trimmedEmail)
        ) {
          return res.status(400).json({
            message: "This email address has already been added.",
          });
        }

        if (!customer.additionalEmails) {
          customer.additionalEmails = [];
        }
        customer.additionalEmails.push(trimmedEmail);
      }

      if (phone !== undefined) {
        const trimmedPhone = typeof phone === "string" ? phone.trim() : "";

        if (!trimmedPhone) {
          return res.status(400).json({ message: "Phone number is required." });
        }

        customer.phone = trimmedPhone;
      }

      if (profilePhotoUrl !== undefined) {
        if (typeof profilePhotoUrl !== "string" || !profilePhotoUrl.trim()) {
          return res
            .status(400)
            .json({ message: "Profile photo URL must be a non-empty string." });
        }

        if (!profilePhotoUrl.startsWith("https://res.cloudinary.com/")) {
          return res.status(400).json({
            message:
              "Profile photo URL must be a valid Cloudinary-hosted image link.",
          });
        }

        customer.profilePhotoUrl = profilePhotoUrl;
      }

      await customer.save();

      return res.status(200).json({
        success: true,
        customer: {
          id: customer._id,
          fullName: customer.fullName,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          preferredName: customer.preferredName,
          additionalEmails: customer.additionalEmails,
          profilePhotoUrl: customer.profilePhotoUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    console.log("[customers:/] reached controller", {
      userRole: req.user?.role,
      userId: req.user?._id?.toString?.(),
    });

    try {
      let queryFilter = { role: "Customer" };

      if (req.user.role === "Sub Admin") {
        queryFilter.createdBy = req.user._id;
      }

      const customerDocuments = await User.find(queryFilter)
        .populate("createdBy", "fullName email role")
        .select("-password -refreshTokens")
        .sort({ createdAt: -1 });

      const restrictedCustomerIds = new Set(
        (req.user.policyRestrictedCustomerIds || []).map((customerId) =>
          customerId.toString(),
        ),
      );

      const customers = customerDocuments.map((customerDocument) => {
        const customer = customerDocument.toObject();

        return {
          ...customer,
          policyCreationRestricted:
            req.user.role === "Sub Admin" &&
            restrictedCustomerIds.has(customerDocument._id.toString()),
        };
      });

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

router.get(
  "/:id",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      const customer = await User.findOne({
        _id: req.params.id,
        role: "Customer",
      })
        .populate("createdBy", "fullName email role")
        .select("-password -refreshTokens");

      if (!customer) {
        return res.status(404).json({ message: "Customer account not found" });
      }

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
          return res
            .status(400)
            .json({ message: "Password must be at least 6 characters." });
        }

        targetUser.password = password;
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
