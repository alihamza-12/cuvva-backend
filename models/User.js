const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // --- Account Basics ---
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

    // --- Flat Address Format (No nested sub-schemas) ---
    address: {
      line1: String,
      line2: String,
      city: String,
      county: String,
      postcode: { type: String, uppercase: true, trim: true },
      country: { type: String, default: "UK" },
    },

    // --- Profile Overrides ---
    preferredName: { type: String, trim: true, default: undefined },

    // --- Additional Emails ---
    additionalEmails: { type: [String], default: [] },

    // --- Tracking & Limits ---
    lastFourDigits: { type: String, trim: true }, // Simple search marker
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
    expiresAt: { type: Date, default: null }, // Time limit for Sub-Admins
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Tracks ownership chain

    // --- Security Passports ---
    refreshTokens: [String],
    resetToken: String,
    resetExpires: Date,
  },
  { timestamps: true },
);

// --- Developer Smart Helper ---
// Automatically splits "Jane Sarah Doe" into "Jane" and "Sarah Doe" before saving
userSchema.pre("save", function (next) {
  if (this.isModified("fullName") && this.fullName) {
    const parts = this.fullName.trim().split(/\s+/);
    this.firstName = parts[0] || "";
    this.lastName = parts.slice(1).join(" ") || "";
  }
  next();
});

// High-speed index keys

userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdBy: 1 });

module.exports = mongoose.model("User", userSchema);
