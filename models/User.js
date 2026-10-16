const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { toTitleCase } = require("../utils/normalizeCase");
const {
  normalizeCardLast4,
  isValidCardLast4,
  isBlankCardLast4,
} = require("../utils/normalizeCardLast4");

const userSchema = new mongoose.Schema(
  {

    /*
     * Names are stored title cased ("jane doe" -> "Jane Doe") so the value the
     * admin typed, the value in MongoDB and the value printed on the policy
     * certificate are always identical. The setter runs on every write path,
     * including findOneAndUpdate-style updates, so no route can bypass it.
     */
    fullName: { type: String, required: true, trim: true, set: toTitleCase },
    firstName: { type: String, set: toTitleCase },
    lastName: { type: String, set: toTitleCase },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    phone: { type: String, trim: true },
    dateOfBirth: { type: Date },
    gender: {
      type: String,
      trim: true,
      enum: ["Male", "Female", "Other", "Prefer not to say"],
    },
    drivingLicenceNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },

    address: {
      // Address prose is stored title cased, postcode is stored uppercase.
      line1: { type: String, set: toTitleCase },
      line2: { type: String, set: toTitleCase },
      city: { type: String, set: toTitleCase },
      county: { type: String, set: toTitleCase },
      postcode: { type: String, uppercase: true, trim: true },
      /*
       * Country is fixed to GB across the platform — it is displayed read-only
       * in every form and is never user-editable.
       */
      country: { type: String, default: "GB" },
    },

    preferredName: {
      type: String,
      trim: true,
      default: undefined,
      set: toTitleCase,
    },
    profilePhotoUrl: { type: String, trim: true, default: null },

    notificationPreferences: {
      policyUpcoming: { type: Boolean, default: true },
      policyActive: { type: Boolean, default: true },
    },

    additionalEmails: { type: [String], default: [] },
    /*
     * Extra contact numbers. The main `phone` is whatever was entered when the
     * customer was created and always takes priority; these are additions only,
     * so "add another number" can never overwrite the primary one.
     */
    additionalPhones: { type: [String], default: [] },

    /*
     * Last four digits of the customer's payment card.
     *
     * Optional at customer creation, then written back here every time a policy
     * is issued for this customer (see POST /api/policies), so the Create Policy
     * screen can pre-fill the payment field on the next visit with whatever the
     * card last used was. Always four digits, or blank.
     */
    lastFourDigits: {
      type: String,
      trim: true,
      default: undefined,
      set: normalizeCardLast4,
      validate: {
        validator: (value) => isBlankCardLast4(value) || isValidCardLast4(value),
        message: "Card last four digits must contain exactly 4 numbers.",
      },
    },
    role: {
      type: String,
      enum: ["Super Admin", "Sub Admin", "Customer"],
      required: true,
    },
    status: {
      type: String,
      enum: ["Active", "Suspended"],
      default: "Active",
    },
    suspendedAt: { type: Date, default: null },
    suspendedUntil: { type: Date, default: null },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    expiresAt: { type: Date, default: null }, 
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Tempify self-registration marker - when user registers via Tempify (client.zavoryn.tech), authSource is "tempify" and createdBy is self
    authSource: { type: String, default: undefined },
    emailVerifiedAt: { type: Date, default: null },

    // Used only for Sub Admin accounts. Customers in this list remain visible
    // to the Sub Admin, but cannot be selected for new policy creation.
    policyRestrictedCustomerIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    refreshTokens: [String],
    resetToken: String,
    resetExpires: Date,
  },
  { timestamps: true },
);

userSchema.pre("save", function (next) {
  if (this.isModified("fullName") && this.fullName) {
    const parts = this.fullName.trim().split(/\s+/);
    this.firstName = parts[0] || "";
    this.lastName = parts.slice(1).join(" ") || "";
  }
  next();
});

userSchema.pre("save", async function (next) {

  if (!this.isModified("password")) {
    return next();
  }

  if (this.password && this.password.startsWith("$2")) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdBy: 1 });
userSchema.index(
  { drivingLicenceNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      role: "Customer",
      drivingLicenceNumber: { $type: "string", $gt: "" },
    },
    collation: { locale: "en", strength: 2 },
  },
);

module.exports = mongoose.model("User", userSchema);
