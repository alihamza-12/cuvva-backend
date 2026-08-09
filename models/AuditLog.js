const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {

    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorRole: String,
    actorEmail: String,

    action: { type: String, required: true }, 
    module: { type: String, required: true }, 
    targetId: String, 

    payloadBefore: Object, 
    payloadAfter: Object, 

    ipAddress: String,
    userAgent: String,
    success: { type: Boolean, default: true },
    errorMessage: String,
  },
  { timestamps: true },
);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ module: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
