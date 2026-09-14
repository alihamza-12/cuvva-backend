const express = require("express");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");
const {
  getCustomerVehicleHistory,
  isValidObjectId,
} = require("../services/customerVehicleHistory");

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
          "fullName email phone dateOfBirth gender drivingLicenceNumber role status expiresAt createdBy createdAt preferredName additionalEmails profilePhotoUrl notificationPreferences address",
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
      const { preferredName, additionalEmail, phone, profilePhotoUrl, address } =
        req.body || {};

      if (
        preferredName === undefined &&
        additionalEmail === undefined &&
        phone === undefined &&
        profilePhotoUrl === undefined &&
        address === undefined
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

      /*
       * Residential address, edited by the customer from the app.
       *
       * Stored on the same User.address sub-document that admin creation
       * writes, so the policy certificate PDF and the in-app policy document
       * immediately pick up the new value — they both read customer.address.
       *
       * Only the keys actually sent are touched, so a partial update cannot
       * wipe fields the form does not show (county/country).
       */
      if (address !== undefined) {
        if (typeof address !== "object" || Array.isArray(address)) {
          return res
            .status(400)
            .json({ message: "Address must be an object." });
        }

        const existingAddress = customer.address || {};
        const nextAddress = {
          line1: existingAddress.line1 || "",
          line2: existingAddress.line2 || "",
          city: existingAddress.city || "",
          county: existingAddress.county || "",
          postcode: existingAddress.postcode || "",
          country: existingAddress.country || "",
        };

        for (const field of ["line1", "line2", "city", "county", "country"]) {
          if (address[field] !== undefined) {
            nextAddress[field] = String(address[field] || "").trim();
          }
        }

        // Postcodes are stored uppercase (User.address.postcode uses
        // `uppercase: true`), matching the admin create forms.
        if (address.postcode !== undefined) {
          nextAddress.postcode = String(address.postcode || "")
            .trim()
            .toUpperCase();
        }

        if (!nextAddress.line1) {
          return res
            .status(400)
            .json({ message: "Address line 1 is required." });
        }
        if (!nextAddress.city) {
          return res.status(400).json({ message: "City / town is required." });
        }
        if (!nextAddress.postcode) {
          return res.status(400).json({ message: "Postcode is required." });
        }

        customer.address = nextAddress;
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
          address: customer.address,
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
        .populate("suspendedBy", "fullName email role")
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
  "/me/notification-preferences",
  verifyJWT,
  authorizeRoles("Customer"),
  async (req, res, next) => {
    try {
      const customer = await User.findById(req.user._id).select(
        "notificationPreferences",
      );
      if (!customer) {
        return res.status(404).json({ message: "Customer account not found" });
      }
      return res.status(200).json({
        success: true,
        preferences: customer.notificationPreferences,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/me/notification-preferences",
  verifyJWT,
  authorizeRoles("Customer"),
  async (req, res, next) => {
    try {
      const allowed = ["policyUpcoming", "policyActive"];
      const update = {};
      for (const field of allowed) {
        if (typeof req.body?.[field] === "boolean") {
          update[`notificationPreferences.${field}`] = req.body[field];
        }
      }
      if (!Object.keys(update).length) {
        return res.status(400).json({ message: "No valid preferences provided." });
      }
      const customer = await User.findOneAndUpdate(
        { _id: req.user._id, role: "Customer" },
        { $set: update },
        { new: true, runValidators: true },
      ).select("notificationPreferences");
      return res.status(200).json({
        success: true,
        preferences: customer.notificationPreferences,
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
        .populate("suspendedBy", "fullName email role")
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
      const { fullName, email, expiresAt, password, address } =
        req.body || {};

      if (
        !fullName &&
        !email &&
        expiresAt === undefined &&
        password === undefined &&
        address === undefined
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

      /*
       * Residential address, edited by an admin.
       *
       * Written to the same User.address sub-document that customer creation
       * and the customer's own app screen use, so the policy certificate PDF
       * and the in-app policy document immediately show the new value.
       *
       * Only the keys actually sent are touched, so a partial update cannot
       * wipe fields the form does not display.
       */
      if (address !== undefined) {
        if (typeof address !== "object" || Array.isArray(address)) {
          return res
            .status(400)
            .json({ message: "Address must be an object." });
        }

        const existingAddress = targetUser.address || {};
        const nextAddress = {
          line1: existingAddress.line1 || "",
          line2: existingAddress.line2 || "",
          city: existingAddress.city || "",
          county: existingAddress.county || "",
          postcode: existingAddress.postcode || "",
          country: existingAddress.country || "",
        };

        for (const field of ["line1", "line2", "city", "county", "country"]) {
          if (address[field] !== undefined) {
            nextAddress[field] = String(address[field] || "").trim();
          }
        }

        // Postcodes are stored uppercase (User.address.postcode uses
        // `uppercase: true`), matching the create forms.
        if (address.postcode !== undefined) {
          nextAddress.postcode = String(address.postcode || "")
            .trim()
            .toUpperCase();
        }

        targetUser.address = nextAddress;
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
          address: targetUser.address,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/*
 * Every vehicle a customer has previously been insured on.
 *
 * Powers the vehicle dropdown on the Create Policy screens so an admin can
 * re-insure an existing car without typing a plate or spending a RegCheck
 * credit. Merges live policies with the retention archive.
 *
 * The existing GET /api/policies/customer/:id is Customer-only, hence this
 * separate admin-authorised route.
 */
router.get(
  "/:customerId/vehicles",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res) => {
    try {
      const { customerId } = req.params;

      if (!isValidObjectId(customerId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid customer id." });
      }

      const customer = await User.findOne({
        _id: customerId,
        role: "Customer",
      }).select("_id createdBy");

      if (!customer) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found." });
      }

      // A Sub Admin may only view customers they created.
      if (req.user.role === "Sub Admin") {
        const ownsCustomer =
          customer.createdBy &&
          customer.createdBy.toString() === req.user._id.toString();

        if (!ownsCustomer) {
          return res.status(403).json({
            success: false,
            message:
              "Forbidden: You can only view vehicles for customers you created.",
          });
        }
      }

      const vehicles = await getCustomerVehicleHistory(customerId);

      // Always 200 with an array — an empty history is not an error.
      return res.status(200).json({ success: true, vehicles });
    } catch (error) {
      console.error("[customers:/:customerId/vehicles]", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to load the customer's vehicle history.",
      });
    }
  },
);

module.exports = router;
