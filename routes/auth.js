const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { verifyJWT, authorizeRoles } = require("../middlewares/auth");
const router = express.Router();

function getCookieOptions(req) {
  const isProduction = process.env.NODE_ENV === "production";

  const isHTTPS = req.secure || req.headers["x-forwarded-proto"] === "https";
  const secureFlag = isProduction ? isHTTPS : false;

  return {
    httpOnly: true, 
    secure: secureFlag, 
    sameSite: "lax", 
    path: "/",
  };
}

router.post(
  "/register",
  verifyJWT,
  authorizeRoles("Super Admin", "Sub Admin"),
  async (req, res, next) => {
    try {
      const {
        fullName,
        email,
        password,
        role,
        expiresAt,
        durationDays,
        dateOfBirth,
        gender,
        drivingLicenceNumber,
      } = req.body;

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

      if (!fullName || !email || !role) {
        return res
          .status(400)
          .json({ message: "All registration fields are required" });
      }

      if (role === "Customer") {
        if (!dateOfBirth) {
          return res.status(400).json({
            message: "Date of birth is required for Customer accounts.",
          });
        }
        if (!gender) {
          return res
            .status(400)
            .json({ message: "Gender is required for Customer accounts." });
        }
        if (!drivingLicenceNumber) {
          return res.status(400).json({
            message:
              "Driving licence number is required for Customer accounts.",
          });
        }
      }

      const userExists = await User.findOne({ email: email.toLowerCase() });
      if (userExists) {
        return res
          .status(400)
          .json({ message: "User already exists with this email" });
      }

      const plainPassword = password || "Cuvva@123";

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
        password: plainPassword,
        role,
        status: "Active",
        createdBy: req.user._id,
        expiresAt: calculatedExpiry,
        dateOfBirth: role === "Customer" ? dateOfBirth : undefined,
        gender: role === "Customer" ? gender : undefined,
        drivingLicenceNumber:
          role === "Customer" ? drivingLicenceNumber : undefined,
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

    const cookieOptions = getCookieOptions(req);

    res.cookie("accessToken", accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, 
    });

    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, 
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

router.post("/logout", verifyJWT, async (req, res, next) => {
  try {
    const refreshToken = req.cookies ? req.cookies.refreshToken : null;

    if (refreshToken) {
      await User.findByIdAndUpdate(req.user._id, {
        $pull: { refreshTokens: refreshToken },
      });
    }

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
