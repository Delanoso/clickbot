import {
  cameraMarkComment,
  cameraMarkLabel,
  classifyCameraScanRow,
  preferCameraMark,
} from "./cameraMarks.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const now = new Date(2026, 7, 13, 15, 21, 0);

assert(cameraMarkLabel("not_available") === "Not available", "not available label");
assert(cameraMarkLabel("stale") === "Old last communicated", "stale label");
assert(preferCameraMark("stale", "not_available") === "not_available", "unavailable wins");
assert(preferCameraMark("not_available", "stale") === "not_available", "do not downgrade");

const unavailable = classifyCameraScanRow(
  {
    status: "not_available",
    lastCommunicated: "4 Aug 2026, 14:54:33",
    text: "H2127 Not available, No Recent Activity",
  },
  { maxAgeDays: 2, now }
);
assert(unavailable.include && unavailable.mark === "not_available", "not available is marked even with old date");

const unavailableRecent = classifyCameraScanRow(
  {
    status: "not_available",
    lastCommunicated: "13 Aug 2026, 15:00:00",
    text: "Not available, No Recent Activity",
  },
  { maxAgeDays: 2, now }
);
assert(
  unavailableRecent.include && unavailableRecent.mark === "not_available",
  "not available is included even if last communicated is recent"
);

const workingOld = classifyCameraScanRow(
  {
    status: "wake",
    lastCommunicated: "10 Aug 2026, 11:05:59",
    text: "NH2447 Wake",
  },
  { maxAgeDays: 2, now }
);
assert(workingOld.include && workingOld.mark === "stale", "working truck with old date is stale");

const workingRecent = classifyCameraScanRow(
  {
    status: "wake",
    lastCommunicated: "12 Aug 2026, 19:55:10",
    text: "NH2419 Wake",
  },
  { maxAgeDays: 2, now }
);
assert(!workingRecent.include, "working truck within 2 days is not listed");

assert(
  cameraMarkComment("not_available", "4 Aug 2026, 14:54:33").includes("Not available, No Recent Activity"),
  "unavailable comment"
);
assert(
  cameraMarkComment("stale", "10 Aug 2026, 11:05:59") === "Last communicated: 10 Aug 2026, 11:05:59",
  "stale comment"
);

console.log("cameraMarks tests passed");
