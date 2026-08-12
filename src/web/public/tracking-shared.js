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
