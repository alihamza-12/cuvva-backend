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

const app = express();

app.use(helmet());
app.use(cookieParser()); // 👈 Essential for parsing cookies from incoming requests

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

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
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
