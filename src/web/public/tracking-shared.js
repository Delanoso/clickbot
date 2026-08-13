/** Shared tracking sub-nav + reason badge helpers for PPE / Incident / Camera. */

export const REASON_META = {
  ppe: { label: "Driver PPE", short: "PPE", path: "/tracking/ppe", tone: "ppe" },
  incident: {
    label: "Driver Incident",
    short: "Incident",
    path: "/tracking/incident",
    tone: "incident",
  },
  camera: {
    label: "Truck Camera",
    short: "Camera",
    path: "/tracking/camera",
    tone: "camera",
  },
};

export function trackingSubnavHtml(active) {
  const items = [
    { id: "overview", label: "All tracking", path: "/tracking" },
    { id: "ppe", label: "Driver PPE", path: "/tracking/ppe" },
    { id: "incident", label: "Driver Incident", path: "/tracking/incident" },
    { id: "camera", label: "Truck Camera", path: "/tracking/camera" },
  ];
  return `<nav class="tracking-subnav" aria-label="Tracking reasons">${items
    .map(
      (item) =>
        `<a class="tracking-subnav-link${item.id === active ? " active" : ""}" href="${item.path}">${item.label}</a>`
    )
    .join("")}</nav>`;
}

/** Fetch export and save as a file — works on iPad Safari (avoids in-browser preview). */
export async function downloadExportFile(url, fallbackName = "tracking-export.xls") {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Export failed (${res.status})`);
  }
  let filename = fallbackName;
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  if (match) filename = match[1];

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function cameraMarkLabel(mark) {
  if (mark === "not_available") return "Not available";
  if (mark === "stale") return "Old last communicated";
  return "";
}

export function cameraMarkBadgeHtml(mark) {
  const label = cameraMarkLabel(mark);
  if (!label) return "";
  const tone = mark === "not_available" ? "unavailable" : "stale";
  return `<span class="reason-badge mark-${tone}">${escapeHtml(label)}</span>`;
}

export function reasonBadgeHtml(reason) {
  const meta = REASON_META[reason] || { short: reason || "?", tone: "other" };
  return `<span class="reason-badge reason-${meta.tone}">${escapeHtml(meta.short)}</span>`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mountTrackingSubnav(active) {
  const host = document.getElementById("trackingSubnav");
  if (host) host.innerHTML = trackingSubnavHtml(active);
}
