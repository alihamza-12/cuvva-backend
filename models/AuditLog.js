const mongoose = require("mongoose");

const { Schema } = mongoose;

const AuditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    actorRole: { type: String },
    actorEmail: { type: String },

    action: { type: String, required: true },
    module: { type: String, required: true },

    targetId: { type: String },

    payloadBefore: { type: Object, default: null },
    payloadAfter: { type: Object, default: null },

    ipAddress: { type: String },
    userAgent: { type: String },

    success: { type: Boolean, default: true },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true },
);

// Helpful indexes (audit log lookups)
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ module: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", AuditLogSchema);
