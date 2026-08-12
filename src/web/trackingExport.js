import { readDepotConfig } from "./depotConfig.js";
import { readIncidentsConfig } from "./incidentsConfig.js";
import { readCameraConfig } from "./cameraConfig.js";
import {
  getDepotSnapshot,
  getIncidentsSnapshot,
  getCameraSnapshot,
} from "./taskManager.js";
import { normalizeReason, reasonLabel } from "./trackingReasons.js";

const HEADER = [
  "Truck",
  "Driver",
  "Comment",
  "Reason",
  "Zone",
  "In Depot",
  "In Johannesburg",
  "Location",
  "Last Checked",
];

/** Flatten newlines so Excel does not insert blank rows between cells. */
export function csvCell(value) {
  const text = String(value ?? "")
    .replace(/\r\n/g, " ")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/[",]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function liveById(snapshot) {
  return new Map(
    (snapshot?.trucks || []).map((row) => [
      String(row.truckNumber || "").toUpperCase(),
      row,
    ])
  );
}

function exportRow(truck, live, reasonText) {
  const inDepot =
    live.inDepot != null ? Boolean(live.inDepot) : Boolean(live.inTargetArea);
  const zone =
    live.zone ||
    (inDepot ? "depot" : live.inJohannesburg ? "johannesburg" : "other");
  return [
    truck.id,
    truck.driver || "",
    truck.comment || "",
    reasonText,
    zone,
    inDepot ? "YES" : "NO",
    live.inJohannesburg ? "YES" : "NO",
    live.locationText || "",
    live.checkedAt || "",
  ]
    .map(csvCell)
    .join(",");
}

function appendSection(lines, trucks, snapshot, reasonKey) {
  const live = liveById(snapshot);
  const label = reasonLabel(reasonKey);
  for (const truck of trucks) {
    lines.push(exportRow(truck, live.get(truck.id) || {}, label));
  }
}

export function buildTrackingExportCsv(reason, configPath = "config/local.json") {
  const raw = String(reason || "all")
    .trim()
    .toLowerCase();
  const normalized = raw === "all" ? "all" : normalizeReason(reason);
  if (!normalized) {
    throw new Error("reason must be all, ppe, incident, or camera");
  }

  const lines = [HEADER.map(csvCell).join(",")];

  if (normalized === "all" || normalized === "ppe") {
    appendSection(
      lines,
      readDepotConfig(configPath).trucks,
      getDepotSnapshot(),
      "ppe"
    );
  }
  if (normalized === "all" || normalized === "incident") {
    appendSection(
      lines,
      readIncidentsConfig(configPath).trucks,
      getIncidentsSnapshot(),
      "incident"
    );
  }
  if (normalized === "all" || normalized === "camera") {
    appendSection(
      lines,
      readCameraConfig(configPath).trucks,
      getCameraSnapshot(),
      "camera"
    );
  }

  return `\uFEFF${lines.join("\r\n")}`;
}

export function trackingExportFilename(reason) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const names = {
    all: "all-tracking",
    ppe: "driver-ppe",
    incident: "driver-incident",
    camera: "truck-camera",
  };
  const key =
    String(reason || "all").trim().toLowerCase() === "all"
      ? "all"
      : normalizeReason(reason) || "tracking";
  return `${names[key] || "tracking"}-${stamp}.csv`;
}
