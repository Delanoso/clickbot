import { mountTrackingSubnav, reasonBadgeHtml, cameraMarkBadgeHtml, escapeHtml, REASON_META, downloadExportFile } from "./tracking-shared.js";

mountTrackingSubnav("overview");

const hostLine = document.getElementById("hostLine");
const clockLine = document.getElementById("clockLine");
const trackDot = document.getElementById("trackDot");
const trackState = document.getElementById("trackState");
const trackMessage = document.getElementById("trackMessage");
const depotSummary = document.getElementById("depotSummary");
const jhbSummary = document.getElementById("jhbSummary");
const inDepotCount = document.getElementById("inDepotCount");
const inJhbCount = document.getElementById("inJhbCount");
const inDepotList = document.getElementById("inDepotList");
const inJhbList = document.getElementById("inJhbList");
const allTruckList = document.getElementById("allTruckList");
const watchedMeta = document.getElementById("watchedMeta");
const truckCount = document.getElementById("truckCount");
const truckFormNote = document.getElementById("truckFormNote");
const addTruckForm = document.getElementById("addTruckForm");
const truckInput = document.getElementById("truckInput");
const reasonSelect = document.getElementById("reasonSelect");
const startAllBtn = document.getElementById("startAllBtn");
const stopAllBtn = document.getElementById("stopAllBtn");
const exportBtn = document.getElementById("exportBtn");
const exportReason = document.getElementById("exportReason");
const watchList = document.getElementById("watchList");

const removingTrucks = new Set();
let latestTrucks = [];

function updateExportLink() {
  /* export uses downloadExportFile on click */
}

exportReason?.addEventListener("change", updateExportLink);
exportBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  const reason = exportReason?.value || "all";
  const names = {
    all: "all-tracking.xls",
    ppe: "driver-ppe.xls",
    incident: "driver-incident.xls",
    camera: "truck-camera.xls",
  };
  void downloadExportFile(
    `/api/tracking/export?reason=${encodeURIComponent(reason)}&t=${Date.now()}`,
    names[reason] || "tracking-export.xls"
  ).catch((error) => {
    truckFormNote.textContent = error.message || "Export failed";
  });
});

watchList?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove]");
  if (!btn || !watchList.contains(btn)) return;
  event.preventDefault();
  void removeTruck(btn.getAttribute("data-remove"), btn.getAttribute("data-reason"));
});

async function removeTruck(truck, reason) {
  const id = String(truck || "").trim();
  const key = `${String(reason || "").toLowerCase()}:${id.toUpperCase()}`;
  if (!id || !reason || removingTrucks.has(key)) return;
  removingTrucks.add(key);
  truckFormNote.textContent = `Removing ${id} from ${REASON_META[reason]?.label || reason}…`;

  try {
    const res = await fetch(
      `/api/tracking/trucks/${encodeURIComponent(id)}?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not remove ${id}`);
    truckFormNote.textContent = data.removed
      ? `Removed ${id} from ${REASON_META[reason]?.short || reason}`
      : `${id} was not on the ${REASON_META[reason]?.short || reason} list`;
    await refresh();
  } catch (error) {
    truckFormNote.textContent = error.message || String(error);
  } finally {
    removingTrucks.delete(key);
  }
}

function renderWatchList(trucks) {
  if (!watchList) return;
  if (!trucks.length) {
    watchList.innerHTML = `<p class="empty-note">No trucks tracked yet. Add one above.</p>`;
    return;
  }
  watchList.innerHTML = trucks
    .map((entry) => {
      const reason = entry.reason || "";
      const meta = REASON_META[reason] || {};
      const busy = removingTrucks.has(`${reason}:${String(entry.id).toUpperCase()}`);
      const driver = entry.driver ? escapeHtml(entry.driver) : "Driver pending";
      const device = entry.device ? ` · Device ${escapeHtml(entry.device)}` : "";
      const comment = entry.comment ? ` · ${escapeHtml(entry.comment)}` : "";
      return `<div class="watch-row">
        <div>
          <strong>${escapeHtml(entry.id)}</strong> ${reasonBadgeHtml(reason)}${reason === "camera" ? cameraMarkBadgeHtml(entry.mark) : ""}
          <span>${driver}${device}${comment}</span>
        </div>
        <button type="button" class="btn danger-btn" data-remove="${escapeHtml(entry.id)}" data-reason="${escapeHtml(reason)}" ${busy ? "disabled" : ""}>Remove</button>
      </div>`;
    })
    .join("");
}

function formatTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function zoneLabel(zone) {
  if (zone === "depot") return "In depot";
  if (zone === "johannesburg") return "In Johannesburg";
  return "Other";
}

function taskState(task) {
  return task?.running
    ? "running"
    : task?.status?.state || (task?.exitCode != null ? "stopped" : "idle");
}

function renderTasks(tasks) {
  const ppe = tasks?.ppe;
  const incident = tasks?.incident;
  const camera = tasks?.camera;
  const states = [ppe, incident, camera].map(taskState);
  const anyRunning = states.includes("running");
  const anyError = states.includes("error") || states.includes("failed");
  const state = anyRunning ? "running" : anyError ? "error" : "idle";
  trackState.textContent = state;
  trackDot.className = `status-dot ${state}`;
  trackMessage.textContent = [
    `PPE: ${taskState(ppe)}`,
    `Incident: ${taskState(incident)}`,
    `Camera: ${taskState(camera)}`,
  ].join(" · ");
}

function renderZoneList(el, rows, emptyMessage) {
  if (!rows.length) {
    el.innerHTML = `<p class="empty-note">${escapeHtml(emptyMessage)}</p>`;
    return;
  }
  el.innerHTML = rows
    .map((row) => {
      const reason = row.reason || "";
      const meta = REASON_META[reason] || {};
      const driver = row.driverName || row.driver || "";
      const comment = row.comment || "";
      const location = row.locationText || row.location || "—";
      return `<div class="truck-row">
        <strong>${escapeHtml(row.truckNumber || row.id)} ${reasonBadgeHtml(reason)}${reason === "camera" ? cameraMarkBadgeHtml(row.mark) : ""}</strong>
        <span>${escapeHtml(driver || "No driver yet")}${
          comment ? ` · ${escapeHtml(comment)}` : ""
        }<br />${escapeHtml(location)}
        <a class="inline-link" href="${escapeHtml(meta.path || "/tracking")}">Open ${escapeHtml(
          meta.short || "section"
        )}</a></span>
      </div>`;
    })
    .join("");
}

function renderBoards(live) {
  const inDepot = live?.inDepot || [];
  const inJhb = live?.inJohannesburg || [];
  const trucks = live?.trucks || [];

  inDepotCount.textContent = String(inDepot.length);
  inJhbCount.textContent = String(inJhb.length);
  depotSummary.textContent = live
    ? `${inDepot.length} tracked truck(s) in depot / target areas`
    : "Start monitors to populate live locations.";
  jhbSummary.textContent = live
    ? `${inJhb.length} tracked truck(s) in Johannesburg`
    : "Start monitors to populate Johannesburg matches.";

  renderZoneList(
    inDepotList,
    inDepot,
    "No tracked trucks currently in the depot."
  );
  renderZoneList(
    inJhbList,
    inJhb,
    "No tracked trucks currently in Johannesburg."
  );

  if (!trucks.length) {
    allTruckList.innerHTML = `<p class="empty-note">No live location rows yet. Start the monitors for each reason.</p>`;
    watchedMeta.textContent = "";
    return;
  }

  watchedMeta.textContent = `${trucks.length} live location row(s) across PPE, Incident, and Camera`;
  allTruckList.innerHTML = trucks
    .map((row) => {
      const reason = row.reason || "";
      const zone =
        row.zone ||
        (row.inDepot || row.inTargetArea
          ? "depot"
          : row.inJohannesburg
            ? "johannesburg"
            : "other");
      const cls =
        zone === "depot" ? "in" : zone === "johannesburg" ? "jhb" : "";
      const driver = row.driverName || row.driver || "No driver";
      const comment = row.comment ? ` · ${escapeHtml(row.comment)}` : "";
      return `<div class="truck-chip ${cls}">
        <strong>${escapeHtml(row.truckNumber || row.id)} ${reasonBadgeHtml(reason)}${reason === "camera" ? cameraMarkBadgeHtml(row.mark) : ""}</strong>
        <span>${zoneLabel(zone)} · ${escapeHtml(driver)}${comment}<br />${escapeHtml(
          row.locationText || "—"
        )}</span>
      </div>`;
    })
    .join("");
}

function renderCounts(counts, trucks) {
  const total = counts?.total ?? trucks?.length ?? 0;
  truckCount.textContent = `${total} truck${total === 1 ? "" : "s"} · PPE ${
    counts?.ppe ?? 0
  } · Incident ${counts?.incident ?? 0} · Camera ${counts?.camera ?? 0}`;
}

async function refresh() {
  const [healthRes, trackingRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/tracking"),
  ]);
  const health = await healthRes.json();
  const payload = await trackingRes.json();
  if (!trackingRes.ok) {
    trackMessage.textContent = payload.error || "Failed to load tracking";
    return;
  }

  const ip = health.addresses?.[0] || location.hostname;
  hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}/tracking`;
  clockLine.textContent = new Date().toLocaleString();

  renderTasks(payload.tasks);
  renderBoards(payload.live);
  renderCounts(payload.counts, payload.trucks);
  latestTrucks = payload.trucks || [];
  renderWatchList(latestTrucks);
}

addTruckForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const truck = truckInput.value.trim();
  const reason = reasonSelect.value;
  if (!truck || !reason) return;

  const submitBtn = addTruckForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  truckInput.disabled = true;
  reasonSelect.disabled = true;
  truckFormNote.textContent = "Saving truck…";

  try {
    const res = await fetch("/api/tracking/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ truck, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not add truck (${res.status})`);
    truckInput.value = "";
    const label = data.reasonLabel || REASON_META[reason]?.label || reason;
    if (data.added) {
      truckFormNote.textContent = data.lookupPending
        ? `Added ${data.truck} for ${label}. Looking up driver…`
        : `Added ${data.truck} for ${label}${data.driver ? ` · ${data.driver}` : ""}`;
    } else if (data.updated) {
      truckFormNote.textContent = `Updated ${data.truck} (${label})${
        data.driver ? ` · ${data.driver}` : ""
      }`;
    } else {
      truckFormNote.textContent = `${data.truck || truck} already on the ${label} list`;
    }
    if (data.restarted) truckFormNote.textContent += " · monitor restarting";
    await refresh();
  } catch (error) {
    truckFormNote.textContent = error.message || String(error);
  } finally {
    truckInput.disabled = false;
    reasonSelect.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
    truckInput.focus();
  }
});

startAllBtn.addEventListener("click", async () => {
  startAllBtn.disabled = true;
  stopAllBtn.disabled = true;
  try {
    const res = await fetch("/api/tracking/start-all", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not start monitors");
    truckFormNote.textContent = "Started PPE, Incident, and Camera monitors";
    await refresh();
  } catch (error) {
    truckFormNote.textContent = error.message || String(error);
  } finally {
    startAllBtn.disabled = false;
    stopAllBtn.disabled = false;
  }
});

stopAllBtn.addEventListener("click", async () => {
  startAllBtn.disabled = true;
  stopAllBtn.disabled = true;
  try {
    const res = await fetch("/api/tracking/stop-all", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not stop monitors");
    truckFormNote.textContent = "Stopped all tracking monitors";
    await refresh();
  } catch (error) {
    truckFormNote.textContent = error.message || String(error);
  } finally {
    startAllBtn.disabled = false;
    stopAllBtn.disabled = false;
  }
});

setInterval(() => {
  clockLine.textContent = new Date().toLocaleString();
}, 1000);

setInterval(() => {
  void refresh();
}, 5000);

void refresh();
