const jwt = require("jsonwebtoken");
const User = require("../models/User"); // Required to check roles and temporal constraints in real-time

/**
 * Global Identity & Authentication Guard (Cookie-Based)
 * Verifies JWT token stored in secure cookies and checks for account suspension or sub-admin expiry status.
 */
async function verifyJWT(req, res, next) {
  try {
    // 1. Extract the token directly from cookies parsed by cookie-parser
    const token = req.cookies ? req.cookies.accessToken : null;

    if (!token) {
      return res
        .status(401)
        .json({
          message: "Access Denied: Missing authentication token session cookie",
        });
    }

    // 2. Verify the structural integrity of the cookie token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Query database for real-time account status fields
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res
        .status(401)
        .json({ message: "Session invalid: User record no longer exists" });
    }

    // 4. Rule Enforcement: Block suspended users immediately
    if (user.status === "Suspended") {
      return res
        .status(403)
        .json({ message: "Access Denied: Your account has been suspended" });
    }

    // 5. Rule Enforcement: Enforce temporal expiry limits for Sub Admins
    if (
      user.role === "Sub Admin" &&
      user.expiresAt &&
      new Date() > user.expiresAt
    ) {
      return res.status(403).json({
        message: "Access Denied: Your Sub Admin access period has expired",
      });
    }

    // Attach full validated user document to the request object for downstream controllers
    req.user = user;
    return next();
  } catch (err) {
    return res
      .status(401)
      .json({ message: "Invalid, altered, or expired session cookie" });
  }
}

/**
 * Role-Based Access Control (RBAC) Gatekeeper
 * Evaluates whether the authenticated user possesses the specific clearances to proceed.
 * Usage: authorizeRoles("Super Admin", "Sub Admin")
 */
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized: Profile identity missing from request pipeline",
      });
    }

    // Enforce role comparison checks against allowed array elements
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Forbidden: Your account role (${req.user.role}) is unauthorized to access this endpoint`,
      });
    }

    return next();
  };
}

module.exports = { verifyJWT, authorizeRoles };
