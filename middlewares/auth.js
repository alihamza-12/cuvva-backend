const jwt = require("jsonwebtoken");

/**
 * JWT Verification placeholder.
 * Temporal Sub-Admin Expiry checks will be implemented in the controller layer later.
 */
function verifyJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) return res.status(401).json({ message: "Missing token" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

module.exports = { verifyJWT };
