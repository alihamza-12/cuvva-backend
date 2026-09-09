const assert = require("assert");
const Module = require("module");

/*
 * Unit test for the customer -> vehicle history merge.
 *
 * The service is loaded with Policy / Vehicle / CustomerVehicleHistory stubbed
 * out, so the merge, de-duplication and sort logic can be exercised without a
 * running MongoDB (matching the dependency-free style of the other tests).
 */

const VEHICLE_A = "aaaaaaaaaaaaaaaaaaaaaaaa"; // in both live + archive
const VEHICLE_B = "bbbbbbbbbbbbbbbbbbbbbbbb"; // live only, most recent
const VEHICLE_C = "cccccccccccccccccccccccc"; // archive only (policy deleted)
const VEHICLE_D = "dddddddddddddddddddddddd"; // archived but vehicle deleted

const livePolicies = [
  {
    vehicleId: VEHICLE_A,
    policyNumber: "CUV-1",
    startDate: new Date("2026-03-01"),
    endDate: new Date("2026-03-01"),
    startTime: "10:00",
    endTime: "12:00",
  },
  {
    vehicleId: VEHICLE_B,
    policyNumber: "CUV-2",
    startDate: new Date("2026-08-01"),
    endDate: new Date("2026-08-01"),
    startTime: "10:00",
    endTime: "12:00",
  },
];

const archivedRows = [
  {
    vehicleId: VEHICLE_A,
    lastUsedAt: new Date("2026-01-05T12:00:00Z"),
    policyCount: 2,
    lastPolicyNumber: "CUV-OLD-A",
  },
  {
    vehicleId: VEHICLE_C,
    lastUsedAt: new Date("2026-05-05T12:00:00Z"),
    policyCount: 3,
    lastPolicyNumber: "CUV-OLD-C",
  },
  {
    vehicleId: VEHICLE_D,
    lastUsedAt: new Date("2026-06-05T12:00:00Z"),
    policyCount: 1,
    lastPolicyNumber: "CUV-OLD-D",
  },
];

// Vehicle D is deliberately absent: deleted via DELETE /api/vehicles/:id.
const vehicleRows = [
  { _id: VEHICLE_A, registration: "AA11AAA", make: "Ford", model: "Focus" },
  { _id: VEHICLE_B, registration: "BB22BBB", make: "BMW", model: "320" },
  { _id: VEHICLE_C, registration: "CC33CCC", make: "Audi", model: "A3" },
];

const chainable = (result) => {
  const chain = {
    select: () => chain,
    sort: () => chain,
    limit: () => chain,
    lean: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
};

const stubs = {
  "../models/Policy": { find: () => chainable(livePolicies) },
  "../models/Vehicle": { find: () => chainable(vehicleRows) },
  "../models/CustomerVehicleHistory": { find: () => chainable(archivedRows) },
};

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) {
    return stubs[request];
  }
  return originalLoad.apply(this, arguments);
};

const {
  getCustomerVehicleHistory,
} = require("../services/customerVehicleHistory");

Module._load = originalLoad;

(async () => {
  const result = await getCustomerVehicleHistory("507f1f77bcf86cd799439011");

  // --- 1. Dangling reference is dropped ------------------------------------
  const registrations = result.map((vehicle) => vehicle.registration);
  assert.ok(
    !registrations.includes(undefined),
    "no nulls should survive the populate step",
  );
  assert.strictEqual(
    result.length,
    3,
    "vehicle D was deleted from the Vehicle collection and must be skipped",
  );

  // --- 2. De-duplicated by vehicleId ---------------------------------------
  const unique = new Set(result.map((vehicle) => String(vehicle._id)));
  assert.strictEqual(unique.size, result.length, "vehicles must be distinct");

  // --- 3. Counts are summed across both sources ----------------------------
  const vehicleA = result.find((vehicle) => String(vehicle._id) === VEHICLE_A);
  assert.strictEqual(
    vehicleA.policyCount,
    3,
    "vehicle A: 1 live policy + 2 archived = 3",
  );

  // --- 4. The most recent lastUsedAt wins ----------------------------------
  // Live policy ended 2026-03-01, archive says 2026-01-05 -> live must win.
  assert.ok(
    new Date(vehicleA.lastUsedAt).getTime() >
      new Date("2026-02-01").getTime(),
    "the newer live-policy date must beat the older archived date",
  );

  // --- 5. Archive-only vehicles are still returned -------------------------
  const vehicleC = result.find((vehicle) => String(vehicle._id) === VEHICLE_C);
  assert.ok(
    vehicleC,
    "vehicle C's policies were deleted by retention, but it must still appear",
  );
  assert.strictEqual(vehicleC.policyCount, 3);

  // --- 6. Sorted most-recently-used first ----------------------------------
  const times = result.map((vehicle) =>
    vehicle.lastUsedAt ? new Date(vehicle.lastUsedAt).getTime() : -Infinity,
  );
  const sorted = [...times].sort((a, b) => b - a);
  assert.deepStrictEqual(times, sorted, "results must be newest-first");
  assert.strictEqual(
    String(result[0]._id),
    VEHICLE_B,
    "vehicle B (Aug 2026) is the most recent and must be first",
  );

  // --- 7. Invalid id returns an empty array, not a throw -------------------
  assert.deepStrictEqual(await getCustomerVehicleHistory("not-an-id"), []);

  console.log(
    "Customer vehicle history tests passed: merged live + archive, de-duplicated, counts summed, newest date wins, dangling refs dropped, newest-first sort.",
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
