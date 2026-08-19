import assert from "node:assert/strict";
import {
  formatStatusLine,
  isInTargetArea,
  normalizeMonitorText,
  toAreaTerms,
} from "./depotMonitor.js";

assert.equal(normalizeMonitorText("  Main   Depot "), "main depot");
assert.deepEqual(toAreaTerms({ targetArea: "Depot", targetAreas: ["Yard", " Gate 2 "] }), [
  "depot",
  "yard",
  "gate 2",
]);

assert.equal(isInTargetArea("Truck parked at Main Depot bay 4", { targetArea: "depot" }), true);
assert.equal(isInTargetArea("At customer site", { targetArea: "depot" }), false);
assert.equal(
  isInTargetArea("Entered Cape Town yard entrance", { targetAreas: ["depot", "yard"] }),
  true
);

assert.equal(
  formatStatusLine("H2512", { locationText: "Main Depot", inTargetArea: true }),
  "H2512: Main Depot [IN AREA]"
);

console.log("depotMonitor.test.js passed");
