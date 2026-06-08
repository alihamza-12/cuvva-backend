/**
 * Tenant ownership barrier placeholder.
 * Ensures Sub Admins can only access assigned Customers/Policies.
 */
function ownershipGuard(req, res, next) {
  // Logic implemented once routing/controllers are introduced.
  return next();
}

module.exports = { ownershipGuard };
