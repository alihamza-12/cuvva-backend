const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {

    fullName: { type: String, required: true, trim: true },
    firstName: { type: String },
    lastName: { type: String },
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
    drivingLicenceNumber: { type: String, trim: true },

    address: {
      line1: String,
      line2: String,
      city: String,
      county: String,
      postcode: { type: String, uppercase: true, trim: true },
      country: { type: String, default: "UK" },
    },

    preferredName: { type: String, trim: true, default: undefined },
    profilePhotoUrl: { type: String, trim: true, default: null },

    additionalEmails: { type: [String], default: [] },

    lastFourDigits: { type: String, trim: true }, 
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
    expiresAt: { type: Date, default: null }, 
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

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

module.exports = mongoose.model("User", userSchema);
