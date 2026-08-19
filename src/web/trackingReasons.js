/** Tracking reasons for Driver PPE / Driver Incident / Truck Camera. */

export const TRACKING_REASONS = Object.freeze({
  PPE: "ppe",
  INCIDENT: "incident",
  CAMERA: "camera",
});

export const TRACKING_REASON_META = Object.freeze({
  ppe: {
    id: "ppe",
    label: "Driver PPE",
    shortLabel: "PPE",
    description: "Trucks tracked for driver PPE checks.",
    path: "/tracking/ppe",
    api: "/api/depot",
    taskId: "depot-monitor",
  },
  incident: {
    id: "incident",
    label: "Driver Incident",
    shortLabel: "Incident",
    description: "Trucks tracked for driver incidents.",
    path: "/tracking/incident",
    api: "/api/incidents",
    taskId: "incidents-monitor",
  },
  camera: {
    id: "camera",
    label: "Truck Camera",
    shortLabel: "Camera",
    description: "Trucks tracked because cameras are not working.",
    path: "/tracking/camera",
    api: "/api/camera",
    taskId: "camera-monitor",
  },
});

export function normalizeReason(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (raw === "ppe" || raw === "driver_ppe" || raw === "driver-ppe") return "ppe";
  if (raw === "incident" || raw === "driver_incident" || raw === "driver-incident") {
    return "incident";
  }
  if (raw === "camera" || raw === "truck_camera" || raw === "truck-camera") {
    return "camera";
  }
  return null;
}

export function reasonLabel(reason) {
  return TRACKING_REASON_META[reason]?.label || String(reason || "Unknown");
}

export function reasonShortLabel(reason) {
  return TRACKING_REASON_META[reason]?.shortLabel || String(reason || "?");
}
