const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const router = express.Router();

// ==========================================
// @route   POST /api/auth/register
// @desc    Hierarchical Registration Endpoint (Super Admin can create Sub Admin/Customer; Sub Admin can only create Customer)
// @access  Protected (Super Admin & Sub Admin Only)
// ==========================================
router.post(
  "/register",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      const { fullName, email, password, role, expiresAt } = req.body;

      // RULE 2 & 3 ENFORCEMENT: Enforce strict creation hierarchy boundaries
      if (role === "Super Admin") {
        return res.status(400).json({
          message:
            "Registration Rejected: A Super Admin cannot be created via endpoints.",
        });
      }

      // Sub Admins are strictly forbidden from spawning anything other than basic Customers
      if (req.user.role === "Sub Admin" && role !== "Customer") {
        return res.status(403).json({
          message:
            "Forbidden: As a Sub Admin, you are exclusively permitted to register 'Customer' accounts.",
        });
      }

      // 1. Enforce required operational fields
      if (!fullName || !email || !password || !role) {
        return res
          .status(400)
          .json({ message: "All registration fields are required" });
      }

      // 2. Prevent duplicate accounts
      const userExists = await User.findOne({ email: email.toLowerCase() });
      if (userExists) {
        return res
          .status(400)
          .json({ message: "User already exists with this email" });
      }

      // 3. Securely hash raw password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // 4. Instantiate new record strictly bound to the validated hierarchical role rules
      const newUser = new User({
        fullName,
        email: email.toLowerCase(),
        password: hashedPassword,
        role, // Dynamically handled based on the validated logic rules above
        status: "Active",
        createdBy: req.user._id, // Audit link: Tracks which admin/sub-admin executed this action
        expiresAt:
          role === "Sub Admin" && expiresAt ? new Date(expiresAt) : null, // Sets temporal constraint window only for Sub Admins
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
        },
      });
    } catch (error) {
      next(error); // Passes execution smoothly to your centralized error handler in app.js
    }
  },
);

// ==========================================
// @route   POST /api/auth/login
// @desc    Direct Database Credentials Verification with Role-Isolated Response Payloads
// @access  Public
// ==========================================
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. Check user input payload
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Please provide both email and password" });
    }

    // 2. Locate user records directly from the database collection
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 3. Status Check: Is account active?
    if (user.status === "Suspended") {
      return res
        .status(403)
        .json({ message: "Your account is suspended. Contact a Super Admin." });
    }

    // 4. Temporal Guard: Has this Sub Admin expired?
    if (
      user.role === "Sub Admin" &&
      user.expiresAt &&
      new Date() > user.expiresAt
    ) {
      return res
        .status(403)
        .json({ message: "Your access window has expired." });
    }

    // 5. Compare cryptographic password match (Validates against seeded password strings too)
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 6. Signs structural Access Token (Valid for 15 minutes)
    const accessToken = jwt.sign(
      { id: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    // 7. Signs stateful Refresh Token (Valid for 7 days)
    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" },
    );

    // 8. Commit refresh array token update to the cluster
    user.refreshTokens.push(refreshToken);
    await user.save();

    // Configure cookie settings for security
    const isProduction = process.env.NODE_ENV === "production";
    const cookieOptions = {
      httpOnly: true, // Prevents client-side scripts (XSS) from reading the tokens
      secure: isProduction, // Enforces HTTPS in production environments
      sameSite: isProduction ? "strict" : "lax", // Protects against CSRF attacks
    };

    // Attach cookies to the response object
    res.cookie("accessToken", accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 minutes in milliseconds
    });

    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    });

    // ========================================================
    // 9. ROLE-ISOLATED RESPONSE ENGINE
    // ========================================================

    // CONDITION A: If the user is a simple Customer / Client
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

    // CONDITION B: If the user is a Management Role (Super Admin or Sub Admin)
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
    next(error); // Passes execution smoothly to your centralized error handler in app.js
  }
});

module.exports = router;
