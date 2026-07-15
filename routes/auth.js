const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");
const router = express.Router();

// Helper function to resolve cookie options dynamically
function getCookieOptions(req) {
  const isProduction = process.env.NODE_ENV === "production";

  // 🚩 CRITICAL FIX FOR SERVERS RUNNING ON HTTP (no SSL/HTTPS)
  // If the request is over HTTP (e.g. http://13.63.158.142), we MUST set secure: false.
  // If we set secure: true over HTTP, the browser will silently discard the cookie!
  const isHTTPS = req.secure || req.headers["x-forwarded-proto"] === "https";
  const secureFlag = isProduction ? isHTTPS : false;

  return {
    httpOnly: true, // Prevents client-side scripts (XSS) from reading the tokens
    secure: secureFlag, // Enforces HTTPS only when the server is actually using HTTPS
    sameSite: "lax", // "lax" is required instead of "strict" when frontend and backend have port differences (e.g. port 80 and port 3000)
    path: "/",
  };
}

// ==========================================
// @route   POST /api/auth/register
// ==========================================
router.post(
  "/register",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      const { fullName, email, password, role, expiresAt, durationDays } =
        req.body;

      if (role === "Super Admin") {
        return res.status(400).json({
          message:
            "Registration Rejected: A Super Admin cannot be created via endpoints.",
        });
      }

      if (req.user.role === "Sub Admin" && role !== "Customer") {
        return res.status(403).json({
          message:
            "Forbidden: As a Sub Admin, you are exclusively permitted to register 'Customer' accounts.",
        });
      }

      if (!fullName || !email || !password || !role) {
        return res
          .status(400)
          .json({ message: "All registration fields are required" });
      }

      const userExists = await User.findOne({ email: email.toLowerCase() });
      if (userExists) {
        return res
          .status(400)
          .json({ message: "User already exists with this email" });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      let calculatedExpiry = null;
      if (durationDays) {
        calculatedExpiry = new Date();
        calculatedExpiry.setDate(
          calculatedExpiry.getDate() + parseInt(durationDays),
        );
      } else if (expiresAt) {
        calculatedExpiry = new Date(expiresAt);
      }

      const newUser = new User({
        fullName,
        email: email.toLowerCase(),
        password: hashedPassword,
        role,
        status: "Active",
        createdBy: req.user._id,
        expiresAt: calculatedExpiry,
      });

      await newUser.save();

      res.status(201).json({
        success: true,
        message: `${role} account registered successfully by ${req.user.role}.`,
        user: {
          id: newUser._id,
          fullName: newUser.fullName,
          email: newUser.email,
          role: newUser.role,
          expiresAt: newUser.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ==========================================
// @route   POST /api/auth/login
// ==========================================
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Please provide both email and password" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.status === "Suspended") {
      return res
        .status(403)
        .json({ message: "Your account is suspended. Contact a Super Admin." });
    }

    if (user.expiresAt && new Date() > user.expiresAt) {
      if (user.role === "Sub Admin") {
        return res.status(403).json({
          message:
            "Your access window has expired. Contact a Super Admin for more subscription.",
        });
      }

      if (user.role === "Customer") {
        const creator = await User.findById(user.createdBy).select(
          "fullName email",
        );
        const managerName = creator
          ? creator.fullName
          : "your system administrator";
        const managerEmail = creator ? creator.email : "support";
        return res.status(403).json({
          message: `Your access window has expired. Contact your administrator ${managerName} (${managerEmail}) for more subscription.`,
        });
      }
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const accessToken = jwt.sign(
      { id: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" },
    );

    user.refreshTokens.push(refreshToken);
    await user.save();

    // 🚩 FIX: Use dynamic cookie options that automatically adapt to HTTP/HTTPS
    const cookieOptions = getCookieOptions(req);

    res.cookie("accessToken", accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    if (user.role === "Customer") {
      return res.status(200).json({
        success: true,
        message: "Customer logged in successfully",
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
        },
      });
    }

    let dashboardRoute = "/sub-admin/dashboard";
    if (user.role === "Super Admin") {
      dashboardRoute = "/super-admin/dashboard";
    }

    return res.status(200).json({
      success: true,
      redirectTo: dashboardRoute,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// @route   POST /api/auth/logout
// ==========================================
router.post("/logout", verifyJWT, async (req, res, next) => {
  try {
    const refreshToken = req.cookies ? req.cookies.refreshToken : null;

    if (refreshToken) {
      await User.findByIdAndUpdate(req.user._id, {
        $pull: { refreshTokens: refreshToken },
      });
    }

    // 🚩 FIX: Use dynamic cookie options
    const cookieOptions = getCookieOptions(req);

    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);

    return res.status(200).json({
      success: true,
      message: `${req.user.role} logged out successfully. Session tokens completely cleared.`,
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// @route   POST /api/auth/refresh-token
// ==========================================
router.post("/refresh-token", async (req, res, next) => {
  try {
    const refreshToken = req.cookies ? req.cookies.refreshToken : null;

    if (!refreshToken) {
      const cookieOptions = getCookieOptions(req);
      res.clearCookie("accessToken", cookieOptions);
      res.clearCookie("refreshToken", cookieOptions);
      return res
        .status(401)
        .json({ message: "Unauthorized: Missing refresh token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (e) {
      const cookieOptions = getCookieOptions(req);
      res.clearCookie("accessToken", cookieOptions);
      res.clearCookie("refreshToken", cookieOptions);
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid or expired refresh token" });
    }

    const user = await User.findById(decoded.id);
    if (!user || !Array.isArray(user.refreshTokens)) {
      const cookieOptions = getCookieOptions(req);
      res.clearCookie("accessToken", cookieOptions);
      res.clearCookie("refreshToken", cookieOptions);
      return res.status(401).json({ message: "Unauthorized: Session invalid" });
    }

    if (!user.refreshTokens.includes(refreshToken)) {
      const cookieOptions = getCookieOptions(req);
      res.clearCookie("accessToken", cookieOptions);
      res.clearCookie("refreshToken", cookieOptions);
      return res
        .status(401)
        .json({ message: "Unauthorized: Refresh token not recognized" });
    }

    const accessToken = jwt.sign(
      { id: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    // 🚩 FIX: Use dynamic cookie options
    const cookieOptions = getCookieOptions(req);

    res.cookie("accessToken", accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000,
    });

    return res
      .status(200)
      .json({ success: true, message: "Access token refreshed" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
