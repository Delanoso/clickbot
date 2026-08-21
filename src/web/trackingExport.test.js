import {
  buildExportRow,
  CAMERA_EXPORT_HEADER,
  csvCell,
  trackingExportHeader,
  TRACKING_EXPORT_HEADER,
} from "./trackingExport.js";
import { isCameraExcelYellow } from "./cameraConfig.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert.deepEqual = (actual, expected, message) => {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
};

assert.deepEqual(
  trackingExportHeader("camera"),
  CAMERA_EXPORT_HEADER,
  "camera header"
);
assert(
  trackingExportHeader("camera")[0] === "Truck" &&
    trackingExportHeader("camera")[1] === "Device" &&
    trackingExportHeader("camera")[2] === "Tag" &&
    trackingExportHeader("camera")[3] === "Comment",
  "camera columns start Truck, Device, Tag, Comment"
);
assert(!trackingExportHeader("camera").includes("Driver"), "camera excel has no Driver");

assert(TRACKING_EXPORT_HEADER.includes("Driver"), "all tracking keeps Driver");
assert(TRACKING_EXPORT_HEADER.includes("Tag"), "all tracking includes Tag");
assert(
  trackingExportHeader("all")[0] === "Truck" &&
    trackingExportHeader("all")[2] === "Driver" &&
    trackingExportHeader("all")[3] === "Tag",
  "all tracking order Truck, Device, Driver, Tag"
);

const cameraRow = buildExportRow(
  {
    id: "H2127",
    device: "MV00140027",
    mark: "not_available",
    comment: "Not available, No Recent Activity",
    driver: "ShouldNotAppear",
  },
  { zone: "depot", inDepot: true, inJohannesburg: false, locationText: "Boksburg", checkedAt: "now" },
  { layout: "camera", reasonText: "Truck Camera" }
);
assert(cameraRow[0] === "H2127", "camera truck");
assert(cameraRow[1] === "MV00140027", "camera device");
assert(cameraRow[2] === "Not available", "camera tag");
assert(cameraRow[3] === "Not available, No Recent Activity", "camera comment");
assert(!cameraRow.includes("ShouldNotAppear"), "camera row omits driver");
assert(!cameraRow.includes("Truck Camera"), "camera row omits reason");

const allRow = buildExportRow(
  {
    id: "NH2447",
    device: "QM40941111",
    mark: "stale",
    comment: "Last communicated: 10 Aug 2026, 11:05:59",
    driver: "Jane Doe",
  },
  {},
  { layout: "all", reasonText: "Truck Camera" }
);
assert(allRow[2] === "Jane Doe", "all tracking keeps driver");
assert(allRow[3] === "Old last communicated", "all tracking tag");
assert(allRow[4].startsWith("Last communicated"), "all tracking comment");
assert(allRow[5] === "Truck Camera", "all tracking reason");

assert(csvCell("line1\r\nline2") === "line1 line2", "csv cells flatten CRLF");
assert(csvCell("line1\nline2") === "line1 line2", "csv cells flatten LF");
assert(!csvCell("a\r\nb").includes("\r"), "csv cells contain no CR");
assert(!csvCell("a\r\nb").includes("\n"), "csv cells contain no LF");

assert(
  isCameraExcelYellow({ listedSince: "2026-08-01" }, new Date("2026-08-21T12:00:00Z")),
  "long-listed truck is yellow"
);
assert(
  !isCameraExcelYellow({ listedSince: "2026-08-21" }, new Date("2026-08-21T12:00:00Z")),
  "first day stays white"
);

console.log("trackingExport tests passed");
