/*
 * One-off (but idempotent) migration.
 *
 * Uppercases values that were saved before the uppercase rules were enforced,
 * across the User and Vehicle collections. Running it twice is safe: the second
 * run finds nothing to change and reports 0 updates.
 *
 * Usage:
 *   node scripts/normalizeExistingUppercase.js
 *   node scripts/normalizeExistingUppercase.js --dry-run
 */

require("dotenv").config();
const mongoose = require("mongoose");

const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const { toUpperTrimmed, toRegistration } = require("../utils/normalizeCase");

const DRY_RUN = process.argv.includes("--dry-run");

const USER_FIELDS = [
  { path: "drivingLicenceNumber", transform: toUpperTrimmed },
  { path: "address.postcode", transform: toUpperTrimmed },
];

const VEHICLE_FIELDS = [
  { path: "registration", transform: toRegistration },
  { path: "vehicleIdentificationNumber", transform: toUpperTrimmed },
  { path: "abiCode", transform: toUpperTrimmed },
  { path: "engineCode", transform: toUpperTrimmed },
  { path: "engineNumber", transform: toUpperTrimmed },
  { path: "euroStatus", transform: toUpperTrimmed },
  { path: "wheelplan", transform: toUpperTrimmed },
];

const getValue = (document, path) =>
  path.split(".").reduce((accumulator, key) => accumulator?.[key], document);

const normalizeCollection = async (Model, label, fields) => {
  let scanned = 0;
  let changed = 0;
  const examples = [];

  const cursor = Model.find({}).cursor();

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    scanned += 1;
    const updates = {};

    for (const { path, transform } of fields) {
      const current = getValue(doc, path);
      if (typeof current !== "string" || !current) continue;

      const next = transform(current);
      if (next !== current) {
        updates[path] = next;
      }
    }

    if (Object.keys(updates).length === 0) continue;

    changed += 1;
    if (examples.length < 5) {
      examples.push(`${doc._id}: ${JSON.stringify(updates)}`);
    }

    if (!DRY_RUN) {
      // updateOne with an explicit $set: the values are already normalised, so
      // this does not depend on schema setters running.
      await Model.updateOne({ _id: doc._id }, { $set: updates });
    }
  }

  console.log(
    `${label}: scanned ${scanned}, ${DRY_RUN ? "would change" : "changed"} ${changed}`,
  );
  examples.forEach((example) => console.log(`   - ${example}`));

  return { scanned, changed };
};

const run = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(
    `Connected. ${DRY_RUN ? "DRY RUN — nothing will be written." : "Applying updates."}`,
  );

  try {
    const users = await normalizeCollection(User, "Users", USER_FIELDS);
    const vehicles = await normalizeCollection(
      Vehicle,
      "Vehicles",
      VEHICLE_FIELDS,
    );

    console.log(
      `\nSummary: ${users.changed + vehicles.changed} document(s) ${
        DRY_RUN ? "would be" : ""
      } updated out of ${users.scanned + vehicles.scanned} scanned.`,
    );
  } catch (error) {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
