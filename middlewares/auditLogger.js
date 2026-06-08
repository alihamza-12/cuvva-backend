/**
 * Action log interceptor snapshot tool placeholder.
 * Controllers will call/trigger AuditLog writes later.
 */
function auditLogger(req, res, next) {
  // Snapshot mechanism will be implemented once route logic exists.
  return next();
}

module.exports = { auditLogger };
