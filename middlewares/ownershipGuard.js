
function ownershipGuard(req, res, next) {

  return next();
}

module.exports = { ownershipGuard };
