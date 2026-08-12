import { readDepotConfig } from "./depotConfig.js";
import { readIncidentsConfig } from "./incidentsConfig.js";
import { readCameraConfig } from "./cameraConfig.js";
import {
  getDepotSnapshot,
  getIncidentsSnapshot,
  getCameraSnapshot,
} from "./taskManager.js";
import { normalizeReason, reasonLabel } from "./trackingReasons.js";

export const TRACKING_EXPORT_HEADER = [
  "Truck",
  "Device",
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

function htmlCell(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function liveById(snapshot) {
  return new Map(
    (snapshot?.trucks || []).map((row) => [
      String(row.truckNumber || "").toUpperCase(),
      row,
    ])
  );
}

function exportRowValues(truck, live, reasonText) {
  const inDepot =
    live.inDepot != null ? Boolean(live.inDepot) : Boolean(live.inTargetArea);
  const zone =
    live.zone ||
    (inDepot ? "depot" : live.inJohannesburg ? "johannesburg" : "other");
  return [
    truck.id,
    truck.device || "",
    truck.driver || "",
    truck.comment || "",
    reasonText,
    zone,
    inDepot ? "YES" : "NO",
    live.inJohannesburg ? "YES" : "NO",
    live.locationText || "",
    live.checkedAt || "",
  ];
}

/** Longer prefixes first so NH/TH/HT don't land in H/T groups. */
const EXPORT_PREFIX_ORDER = ["NH", "TH", "HT", "MBV", "GT", "HD", "H", "R"];

function truckExportPrefix(id) {
  const upper = String(id || "").toUpperCase().trim();
  for (const prefix of EXPORT_PREFIX_ORDER) {
    if (upper.startsWith(prefix)) return prefix;
  }
  const letters = upper.match(/^([A-Z]+)/);
  return letters ? letters[1] : upper;
}

function compareExportTrucks(a, b) {
  const pa = truckExportPrefix(a.id);
  const pb = truckExportPrefix(b.id);
  const ia = EXPORT_PREFIX_ORDER.indexOf(pa);
  const ib = EXPORT_PREFIX_ORDER.indexOf(pb);
  const ra = ia >= 0 ? ia : EXPORT_PREFIX_ORDER.length;
  const rb = ib >= 0 ? ib : EXPORT_PREFIX_ORDER.length;
  if (ra !== rb) return ra - rb;
  if (pa !== pb) return pa.localeCompare(pb);
  return String(a.id).localeCompare(String(b.id), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortExportTrucks(trucks) {
  return [...(trucks || [])].sort(compareExportTrucks);
}

function appendSection(rows, trucks, snapshot, reasonKey) {
  const live = liveById(snapshot);
  const label = reasonLabel(reasonKey);
  for (const truck of sortExportTrucks(trucks)) {
    rows.push(exportRowValues(truck, live.get(truck.id) || {}, label));
  }
}

export function collectTrackingExportRows(reason, configPath = "config/local.json") {
  const raw = String(reason || "all")
    .trim()
    .toLowerCase();
  const normalized = raw === "all" ? "all" : normalizeReason(reason);
  if (!normalized) {
    throw new Error("reason must be all, ppe, incident, or camera");
  }

  const rows = [];
  if (normalized === "all" || normalized === "ppe") {
    appendSection(
      rows,
      readDepotConfig(configPath).trucks,
      getDepotSnapshot(),
      "ppe"
    );
  }
  if (normalized === "all" || normalized === "incident") {
    appendSection(
      rows,
      readIncidentsConfig(configPath).trucks,
      getIncidentsSnapshot(),
      "incident"
    );
  }
  if (normalized === "all" || normalized === "camera") {
    appendSection(
      rows,
      readCameraConfig(configPath).trucks,
      getCameraSnapshot(),
      "camera"
    );
  }
  return rows;
}

export function buildTrackingExportCsv(reason, configPath = "config/local.json") {
  const rows = collectTrackingExportRows(reason, configPath);
  const lines = [
    TRACKING_EXPORT_HEADER.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ];
  // sep= helps Excel pick comma delimiter; BOM + CRLF for Windows Excel.
  return `\uFEFFsep=,\r\n${lines.join("\r\n")}\r\n`;
}

/** HTML table opens reliably in Excel desktop and mobile (legacy .xls trick). */
export function buildTrackingExportExcelHtml(
  reason,
  configPath = "config/local.json"
) {
  const rows = collectTrackingExportRows(reason, configPath);
  const head = TRACKING_EXPORT_HEADER.map(
    (label) => `<th>${htmlCell(label)}</th>`
  ).join("");
  const body = rows
    .map((row) => {
      const cells = row.map((value) => `<td>${htmlCell(value)}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="utf-8" />
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Tracking</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
<table border="1" cellspacing="0" cellpadding="4">
<thead><tr>${head}</tr></thead>
<tbody>${body}</tbody>
</table>
</body>
</html>`;
}

export function trackingExportFilename(reason, { excel = true } = {}) {
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
  const ext = excel ? "xls" : "csv";
  return `${names[key] || "tracking"}-${stamp}.${ext}`;
}
