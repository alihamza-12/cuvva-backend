const jwt = require("jsonwebtoken");
const User = require("../models/User"); 

async function verifyJWT(req, res, next) {
  try {

    const token = req.cookies ? req.cookies.accessToken : null;

    if (!token) {
      return res
        .status(401)
        .json({
          message: "Access Denied: Missing authentication token session cookie",
        });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res
        .status(401)
        .json({ message: "Session invalid: User record no longer exists" });
    }

    if (user.status === "Suspended") {
      return res
        .status(403)
        .json({ message: "Access Denied: Your account has been suspended" });
    }

    if (
      user.role === "Sub Admin" &&
      user.expiresAt &&
      new Date() > user.expiresAt
    ) {
      return res.status(403).json({
        message: "Access Denied: Your Sub Admin access period has expired",
      });
    }

    req.user = user;
    return next();
  } catch (err) {
    return res
      .status(401)
      .json({ message: "Invalid, altered, or expired session cookie" });
  }
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized: Profile identity missing from request pipeline",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Forbidden: Your account role (${req.user.role}) is unauthorized to access this endpoint`,
      });
    }

    return next();
  };
}

module.exports = { verifyJWT, authorizeRoles };
