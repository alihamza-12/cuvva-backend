const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");

const router = express.Router();

// ==========================================
// @route   POST /api/auth/register
// @desc    Strict Customer Creation Endpoint (No Admins Can Be Registered)
// @access  Protected (Super Admin & Sub Admin Only)
// ==========================================
router.post(
  "/register",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      const { fullName, email, password, role } = req.body;

      // RULE 2 & 3 ENFORCEMENT: Block any attempts to spawn management roles via endpoints
      if (role && role !== "Customer") {
        return res.status(400).json({
          message:
            "Registration Rejected: Management roles cannot be created via endpoint. This route exclusively spawns 'Customer' accounts.",
        });
      }

      // 1. Enforce required operational fields
      if (!fullName || !email || !password) {
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

      // 4. Instantiate new record strictly bound to the 'Customer' role
      const newCustomer = new User({
        fullName,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: "Customer", // Hard-locked programmatic fallback
        status: "Active",
        createdBy: req.user._id, // Audit link: Tracks which admin/sub-admin executed this action
        expiresAt: null, // Customers retain standard persistent access
      });

      await newCustomer.save();

      res.status(201).json({
        success: true,
        message: `Customer account registered successfully by ${req.user.role}.`,
        user: {
          id: newCustomer._id,
          fullName: newCustomer.fullName,
          email: newCustomer.email,
          role: newCustomer.role,
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
      { expiresIn: "15m" }
    );

    // 7. Signs stateful Refresh Token (Valid for 7 days)
    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    // 8. Commit refresh array token update to the cluster
    user.refreshTokens.push(refreshToken);
    await user.save();

    // ========================================================
    // 9. ROLE-ISOLATED RESPONSE ENGINE
    // ========================================================
    
    // CONDITION A: If the user is a simple Customer / Client
    if (user.role === "Customer") {
      return res.status(200).json({
        success: true,
        message: "Customer logged in successfully",
        accessToken,
        user: {
          id: user._id,
          email: user.email,
          role: user.role
        }
      });
    }

    // CONDITION B: If the user is a Management Role (Super Admin or Sub Admin)
    let dashboardRoute = "/sub-admin/dashboard";
    if (user.role === "Super Admin") {
      dashboardRoute = "/super-admin/dashboard";
    }

    return res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
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
