const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    // --- Who did it (The Actor) ---
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorRole: String,
    actorEmail: String,

    // --- What happened (The Event) ---
    action: { type: String, required: true }, // e.g., 'CREATE_CUSTOMER', 'CANCEL_POLICY'
    module: { type: String, required: true }, // e.g., 'Customer', 'Policy'
    targetId: String, // The unique ID of the document being modified

    // --- State Snapshots ---
    payloadBefore: Object, // Data snapshot BEFORE the change
    payloadAfter: Object, // Data snapshot AFTER the change

    // --- Connection & Status Details ---
    ipAddress: String,
    userAgent: String,
    success: { type: Boolean, default: true },
    errorMessage: String,
  },
  { timestamps: true },
);

// --- High-Speed Query Performance Indexes ---
// Optimized for sorting logs by newest first (-1)
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ module: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
