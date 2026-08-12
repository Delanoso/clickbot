import { mountTrackingSubnav, reasonBadgeHtml, escapeHtml, REASON_META } from "./tracking-shared.js";

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
        <strong>${escapeHtml(row.truckNumber || row.id)} ${reasonBadgeHtml(reason)}</strong>
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
        <strong>${escapeHtml(row.truckNumber || row.id)} ${reasonBadgeHtml(reason)}</strong>
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
