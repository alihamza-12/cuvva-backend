require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
// --- Import Security Middlewares ---
const { verifyJWT } = require("./middlewares/auth"); // Added to intercept operational requests

const authRoutes = require("./routes/auth");

const vehicleRoutes = require("./routes/vehicles");
const policyRoutes = require("./routes/policies");
const customerRoutes = require("./routes/customers"); // 1. Import the new customer manager router
const managementRoutes = require("./routes/management");

const app = express();

app.use(helmet());
app.use(cookieParser()); // 👈 Essential for parsing cookies from incoming requests

// Debug aid (dev only): confirm whether refreshToken cookie arrives on refresh calls
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    if (req.path.includes("/api/auth/refresh-token")) {
      // eslint-disable-next-line no-console
      console.log(
        "[auth] refresh-token cookies present:",
        req.cookies ? req.cookies : null,
      );
    }
    next();
  });
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(morgan("combined"));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// Route gates (placeholders; no controller logic).
app.use("/api/auth", authRoutes);
app.use("/api/vehicles", verifyJWT, vehicleRoutes);
app.use("/api/policies", verifyJWT, policyRoutes);
app.use("/api/customers", customerRoutes); // 2. Mount the gateway pipeline (verifyJWT is handled inside)
app.use("/api/management", managementRoutes);

//updated health check to verify ci/cd
app.get("/health", (req, res) => {
  
  console.log('🚀 CI/CD Automation: New deployment successfully verified!');
  
  res.status(200).json({ 
    status: "test: verifying fully automated backend pipeline",
    cicd_working: true,
    message: "test: verifying fully automated backend pipeline",
    deployed_at: new Date().toLocaleString()
  });
});

// Centralized error handler.
// Keep minimal; no endpoint implementations yet.
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error("[app] Unhandled error", err);
  res.status(500).json({ message: "Internal Server Error" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

module.exports = app;
