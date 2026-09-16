/*
 * One-off (but idempotent) migration.
 *
 * Fixes records that were saved before the title-case / card rules were
 * enforced:
 *
 *   - User names      : "jane doe"        -> "Jane Doe"
 *   - Address prose   : "12 high street"  -> "12 High Street"
 *                       (line1, line2, city, county)
 *   - Vehicle colour  : "blue"            -> "Blue"
 *   - Card last 4     : "12 34"           -> "1234" (digits only, max 4);
 *                       anything that is not exactly 4 digits is cleared
 *                       rather than left in a broken state.
 *
 * Uppercase fields (postcode, driving licence, registration, VIN, codes) are
 * handled by the sibling script `normalizeExistingUppercase.js`.
 *
 * Running it twice is safe: the second run finds nothing to change.
 *
 * Usage:
 *   node scripts/normalizeExistingTitleCase.js
 *   node scripts/normalizeExistingTitleCase.js --dry-run
 */

require("dotenv").config();
const mongoose = require("mongoose");

const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const { toTitleCase } = require("../utils/normalizeCase");
const { isValidCardLast4, normalizeCardLast4 } = require("../utils/normalizeCardLast4");

const DRY_RUN = process.argv.includes("--dry-run");

const USER_FIELDS = [
  { path: "fullName", transform: toTitleCase },
  { path: "firstName", transform: toTitleCase },
  { path: "lastName", transform: toTitleCase },
  { path: "preferredName", transform: toTitleCase },
  { path: "address.line1", transform: toTitleCase },
  { path: "address.line2", transform: toTitleCase },
  { path: "address.city", transform: toTitleCase },
  { path: "address.county", transform: toTitleCase },
  {
    path: "lastFourDigits",
    // Keep a valid 4 digit marker, drop anything that cannot be salvaged.
    transform: (value) => {
      const digits = normalizeCardLast4(value);
      return isValidCardLast4(digits) ? digits : null;
    },
  },
];

const VEHICLE_FIELDS = [{ path: "colour", transform: toTitleCase }];

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

      if (current === undefined || current === null || current === "") continue;

      const next = transform(current);
      if (next !== null && next !== current) {
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
    const vehicles = await normalizeCollection(Vehicle, "Vehicles", VEHICLE_FIELDS);

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
