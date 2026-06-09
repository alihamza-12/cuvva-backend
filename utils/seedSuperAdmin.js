const bcrypt = require("bcryptjs");
const User = require("../models/User");

const seedSuperAdmin = async () => {
  try {
    const existingAdmin = await User.findOne({
      email: "superadmin@cuvvaclone.com",
    });

    if (existingAdmin) {
      console.log("[seed] Super Admin already exists");
      return;
    }

    const hashedPassword = await bcrypt.hash("SuperAdminPass2026!", 10);

    // console.log(hashedPassword);

    await User.create({
      fullName: "Super Admin",
      email: "superadmin@cuvvaclone.com",
      password: hashedPassword,
      role: "Super Admin",
      status: "Active",
      refreshTokens: [],
    });

    console.log("[seed] Super Admin created successfully");
  } catch (error) {
    console.error("[seed] Failed:", error);
  }
};

module.exports = seedSuperAdmin;
