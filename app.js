require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const { verifyJWT } = require("./middlewares/auth");

const authRoutes = require("./routes/auth");
const vehicleRoutes = require("./routes/vehicles");
const policyRoutes = require("./routes/policies");
const customerRoutes = require("./routes/customers");
const managementRoutes = require("./routes/management");

const app = express();

// Keep - fixes X-Forwarded-For and ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
app.set("trust proxy", 1);

app.use(helmet());
app.use(cookieParser());

if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    if (req.path.includes("/api/auth/refresh-token")) {
      console.log("[auth] refresh-token cookies present:", req.cookies ? req.cookies : null);
    }
    next();
  });
}

// Correct CORS - blocks unknown origins instead of allowing all
const rawOrigin = process.env.CORS_ORIGIN || "";
const allowedOrigins = rawOrigin
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin is not allowed"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined"));

app.get("/health", (req, res) => {
  console.log("🚀 CI/CD Automation: New deployment successfully verified!");
  res.status(200).json({
    status: "test: verifying fully automated backend pipeline",
    cicd_working: true,
    message: "test: verifying fully automated backend pipeline",
    deployed_at: new Date().toLocaleString(),
  });
});

// Limiters defined but NOT used - as requested to guarantee correct password is always checked
// No custom keyGenerator, no validate:false, only limit (not max)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again later." },
});

// Removed limiter registrations to ensure:
// Wrong password -> 401, server continues
// Correct password -> always checked, never blocked by 429
// If you want to re-enable later, add them back with careful logic

app.use("/api/auth", authRoutes);
app.use("/api/vehicles", verifyJWT, vehicleRoutes);
app.use("/api/policies", verifyJWT, policyRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/management", managementRoutes);

// Serve frontend
const distPath = path.join(__dirname, "..", "frontend", "dist");
app.use(express.static(distPath));
app.get(/^\/(?!api\/|health).*/, (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.use((err, req, res, next) => {
  console.error("[app] Unhandled error", err);
  if (res.headersSent) return next(err);
  if (err.message === "CORS origin is not allowed") {
    return res.status(403).json({ message: "CORS origin is not allowed" });
  }
  return res.status(500).json({ message: "Internal Server Error" });
});

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

module.exports = app;
