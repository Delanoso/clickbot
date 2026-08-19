import { classifyLastCommunicated } from "../utils/lastCommunicated.js";

export const CAMERA_MARK_NOT_AVAILABLE = "not_available";
export const CAMERA_MARK_STALE = "stale";

export function normalizeCameraMark(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    raw === "not_available" ||
    raw === "unavailable" ||
    raw === "no_recent_activity"
  ) {
    return CAMERA_MARK_NOT_AVAILABLE;
  }
  if (raw === "stale" || raw === "stale_date" || raw === "old_date") {
    return CAMERA_MARK_STALE;
  }
  return "";
}

export function cameraMarkLabel(mark) {
  const normalized = normalizeCameraMark(mark);
  if (normalized === CAMERA_MARK_NOT_AVAILABLE) return "Not available";
  if (normalized === CAMERA_MARK_STALE) return "Old last communicated";
  return "";
}

export function cameraMarkComment(mark, lastCommunicated = "") {
  const normalized = normalizeCameraMark(mark);
  const last = String(lastCommunicated || "").trim();
  if (normalized === CAMERA_MARK_NOT_AVAILABLE) {
    return last
      ? `Not available, No Recent Activity · Last communicated: ${last}`
      : "Not available, No Recent Activity";
  }
  if (normalized === CAMERA_MARK_STALE) {
    return last
      ? `Last communicated: ${last}`
      : "Last communicated older than 2 days";
  }
  return "";
}

export function isAutoCameraComment(comment) {
  return /^(Not available, No Recent Activity|Last communicated:|Last communicated older than)/i.test(
    String(comment || "").trim()
  );
}

/** Not available always wins over an old last-communicated mark. */
export function preferCameraMark(current, incoming) {
  const next = normalizeCameraMark(incoming);
  const prev = normalizeCameraMark(current);
  if (next === CAMERA_MARK_NOT_AVAILABLE || prev === CAMERA_MARK_NOT_AVAILABLE) {
    return CAMERA_MARK_NOT_AVAILABLE;
  }
  return next || prev || "";
}

export function rowLooksNotAvailable(row) {
  if (row?.status === "not_available") return true;
  return /not available|no recent activity/i.test(String(row?.text || ""));
}

/**
 * Decide whether a Lytx Vehicles row belongs on Truck Camera, and how to mark it.
 * Not available is included even if the date is recent or unparsed.
 */
export function classifyCameraScanRow(row, { maxAgeDays = 2, now = new Date() } = {}) {
  const verdict = classifyLastCommunicated(row?.lastCommunicated, { maxAgeDays, now });
  if (rowLooksNotAvailable(row)) {
    return {
      include: true,
      mark: CAMERA_MARK_NOT_AVAILABLE,
      dateReason: verdict.reason,
    };
  }
  if (verdict.stale) {
    return {
      include: true,
      mark: CAMERA_MARK_STALE,
      dateReason: verdict.reason,
    };
  }
  return { include: false, mark: "", dateReason: verdict.reason };
}
