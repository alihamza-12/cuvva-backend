require("dotenv").config();
const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  // eslint-disable-next-line no-console
  console.warn("[database] Missing MONGODB_URI in environment");
}

async function connectDB() {
  const uri = MONGODB_URI;

  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    autoIndex: true,
    maxPoolSize: 10,
  });

  // eslint-disable-next-line no-console
  console.log("[database] Connected to MongoDB");
}

module.exports = connectDB;
