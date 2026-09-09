const mongoose = require("mongoose");

const Policy = require("../models/Policy");
const Vehicle = require("../models/Vehicle");
const CustomerVehicleHistory = require("../models/CustomerVehicleHistory");
const { getPolicyWindow } = require("../utils/policyStatus");

/*
 * Builds "every distinct vehicle this customer has ever been insured on".
 *
 * There are two sources, and BOTH are required:
 *
 *   1. Live Policy documents — the normal case.
 *   2. CustomerVehicleHistory — the archive written by the retention job
 *      before it hard-deletes a policy that ended more than 20 days ago.
 *
 * Without (2) the dropdown would silently empty out as policies age away.
 * Results are de-duplicated by vehicleId, policy counts are summed, and the
 * most recent `lastUsedAt` wins.
 */

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * @returns {Promise<Array>} vehicles, most-recently-used first, each with
 *          `lastUsedAt` and `policyCount` attached.
 */
const getCustomerVehicleHistory = async (customerId) => {
  if (!isValidObjectId(customerId)) return [];

  const [policies, archived] = await Promise.all([
    Policy.find({ customerId })
      .select("vehicleId policyNumber startDate endDate startTime endTime")
      .lean(),
    CustomerVehicleHistory.find({ customerId }).lean(),
  ]);

  /** @type {Map<string, {vehicleId: string, lastUsedAt: Date|null, policyCount: number, lastPolicyNumber: string|null}>} */
  const merged = new Map();

  const absorb = (vehicleId, lastUsedAt, policyCount, lastPolicyNumber) => {
    if (!vehicleId) return;
    const key = String(vehicleId);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        vehicleId: key,
        lastUsedAt: lastUsedAt || null,
        policyCount: policyCount || 0,
        lastPolicyNumber: lastPolicyNumber || null,
      });
      return;
    }

    existing.policyCount += policyCount || 0;

    if (
      lastUsedAt &&
      (!existing.lastUsedAt ||
        new Date(lastUsedAt).getTime() > new Date(existing.lastUsedAt).getTime())
    ) {
      existing.lastUsedAt = lastUsedAt;
      existing.lastPolicyNumber = lastPolicyNumber || existing.lastPolicyNumber;
    }
  };

  // 1. Live policies. Use the real UK cover-end instant where we can resolve
  //    it, so "last insured" matches what the rest of the app shows.
  for (const policy of policies) {
    const window = getPolicyWindow(policy);
    const lastUsedAt = window
      ? new Date(window.endMs)
      : policy.endDate || null;
    absorb(policy.vehicleId, lastUsedAt, 1, policy.policyNumber);
  }

  // 2. Archived pairs from deleted policies.
  for (const row of archived) {
    absorb(row.vehicleId, row.lastUsedAt, row.policyCount || 0, row.lastPolicyNumber);
  }

  if (merged.size === 0) return [];

  // Resolve the vehicles themselves. A vehicle can be deleted independently via
  // DELETE /api/vehicles/:id, which leaves a dangling reference here — those are
  // dropped rather than returned as nulls.
  const vehicles = await Vehicle.find({
    _id: { $in: [...merged.keys()] },
  })
    .select(
      "registration make model colour yearOfManufacture fuelType bodyStyle transmission engineCapacity vehicleIdentificationNumber lookupSource sourceType createdAt updatedAt",
    )
    .lean();

  const decorated = vehicles.map((vehicle) => {
    const meta = merged.get(String(vehicle._id));
    return {
      ...vehicle,
      lastUsedAt: meta?.lastUsedAt || null,
      policyCount: meta?.policyCount || 0,
      lastPolicyNumber: meta?.lastPolicyNumber || null,
    };
  });

  // Most recently used first; vehicles with no date sink to the bottom.
  decorated.sort((a, b) => {
    const left = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : -Infinity;
    const right = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : -Infinity;
    return right - left;
  });

  return decorated;
};

module.exports = { getCustomerVehicleHistory, isValidObjectId };
