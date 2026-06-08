const mongoose = require("mongoose");

const { Schema } = mongoose;

const AddressSchema = new Schema(
  {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    county: { type: String, trim: true },
    postcode: { type: String, required: true, trim: true, uppercase: true },
    country: { type: String, default: "UK", trim: true, uppercase: true },
  },
  { _id: false },
);

const UserSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },

    email: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      required: true,
    },
    passwordHash: { type: String, required: true },

    phone: { type: String, trim: true },
    dateOfBirth: { type: Date },

    address: { type: AddressSchema, required: false },

    lastFourDigits: { type: String, maxlength: 4, trim: true },

    role: {
      type: String,
      enum: ["Super Admin", "Sub Admin", "Customer"],
      required: true,
    },

    status: { type: String, enum: ["Active", "Suspended"], default: "Active" },

    // Temporal expiration limit applied exclusively to Sub Admins.
    expiresAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", index: true },

    refreshTokens: { type: [String], default: [] },

    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true },
);

UserSchema.pre("save", function preSave(next) {
  if (this.fullName) {
    const trimmed = String(this.fullName).trim().replace(/\s+/g, " ");
    this.fullName = trimmed;

    const parts = trimmed.split(" ");
    this.firstName = parts[0] || "";
    this.lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  }
  next();
});

// Query Performance Indexes
UserSchema.index({ email: 1 }, { weights: { email: 1 } });
UserSchema.index({ role: 1, status: 1 }, { weights: { role: 1, status: 1 } });
UserSchema.index(
  { createdBy: 1, role: 1 },
  { weights: { createdBy: 1, role: 1 } },
);

module.exports = mongoose.model("User", UserSchema);
