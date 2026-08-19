import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addCameraTruck,
  listCameraTrucks,
  syncCameraTrucksFromStaleScan,
} from "./cameraConfig.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const testDir = join(tmpdir(), `clickbot-camera-config-${process.pid}`);
const configPath = join(testDir, "local.json");

function resetConfig(trucks = []) {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify({ cameraWatch: { trucks } }, null, 2)}\n`
  );
}

resetConfig();

const first = syncCameraTrucksFromStaleScan(
  [
    {
      vehicleId: "H2127",
      device: "12345",
      mark: "stale",
      lastCommunicated: "11 Aug 2026, 10:00:00",
    },
  ],
  { configPath }
);
assert(first.addedCount === 1, "sync adds a new truck");
assert(first.removedCount === 0, "sync does not remove on first add");
assert(listCameraTrucks(configPath).length === 1, "one truck on camera list");

addCameraTruck("H9999", { comment: "Manual follow-up", configPath });

const second = syncCameraTrucksFromStaleScan(
  [
    {
      vehicleId: "H2127",
      device: "12345",
      mark: "stale",
      lastCommunicated: "11 Aug 2026, 10:00:00",
    },
  ],
  { configPath }
);
assert(second.removedCount === 1, "truck not on scan is removed");
assert(second.removedTrucks.includes("H9999"), "removed truck id is reported");
assert(
  listCameraTrucks(configPath).every((entry) => entry.id === "H2127"),
  "only scan hits remain"
);

addCameraTruck("H2127", { comment: "Call depot about this unit", configPath });

const third = syncCameraTrucksFromStaleScan(
  [
    {
      vehicleId: "H2127",
      device: "12345",
      mark: "stale",
      lastCommunicated: "12 Aug 2026, 09:15:00",
      comment: "Last communicated: 12 Aug 2026, 09:15:00",
    },
  ],
  { configPath }
);
assert(third.alreadyListed === 1 || third.updatedCount === 0, "still listed truck stays");
assert(
  listCameraTrucks(configPath)[0].comment === "Call depot about this unit",
  "custom comment is kept when truck stays on scan"
);

resetConfig([
  {
    id: "H3001",
    driver: "",
    comment: "Last communicated: 10 Aug 2026, 08:00:00",
    device: "999",
    mark: "stale",
  },
]);

const fourth = syncCameraTrucksFromStaleScan(
  [
    {
      vehicleId: "H3001",
      device: "999",
      mark: "stale",
      lastCommunicated: "13 Aug 2026, 14:00:00",
      comment: "Last communicated: 13 Aug 2026, 14:00:00",
    },
  ],
  { configPath }
);
assert(fourth.updatedCount === 1, "auto comment can refresh when still on scan");
assert(
  listCameraTrucks(configPath)[0].comment.includes("13 Aug 2026"),
  "auto comment updates to latest scan text"
);

const fifth = syncCameraTrucksFromStaleScan([], { configPath });
assert(fifth.removedCount === 1, "empty scan clears the camera list");
assert(listCameraTrucks(configPath).length === 0, "no trucks left after empty scan");

rmSync(testDir, { recursive: true, force: true });
console.log("cameraConfig.test.js: all assertions passed");
