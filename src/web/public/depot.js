const hostLine = document.getElementById("hostLine");
const clockLine = document.getElementById("clockLine");
const depotDot = document.getElementById("depotDot");
const depotState = document.getElementById("depotState");
const depotMessage = document.getElementById("depotMessage");
const depotSummary = document.getElementById("depotSummary");
const inDepotCount = document.getElementById("inDepotCount");
const inDepotList = document.getElementById("inDepotList");
const allTruckList = document.getElementById("allTruckList");
const watchedMeta = document.getElementById("watchedMeta");
const watchList = document.getElementById("watchList");
const truckCount = document.getElementById("truckCount");
const truckFormNote = document.getElementById("truckFormNote");
const addTruckForm = document.getElementById("addTruckForm");
const truckInput = document.getElementById("truckInput");
const logView = document.getElementById("logView");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

/** Bumped to ignore stale poll responses after add/remove. */
let refreshGeneration = 0;
const removingTrucks = new Set();

startBtn.addEventListener("click", () => controlTask("start"));
stopBtn.addEventListener("click", () => controlTask("stop"));

// Event delegation so Remove still works when the poll re-renders the list.
watchList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove]");
  if (!btn || !watchList.contains(btn)) return;
  event.preventDefault();
  void removeTruck(btn.getAttribute("data-remove"));
});

addTruckForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const truck = truckInput.value.trim();
  if (!truck) return;

  const submitBtn = addTruckForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  truckInput.disabled = true;
  truckFormNote.textContent = "Saving truck…";

  try {
    const res = await fetch("/api/depot/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ truck }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not add truck (${res.status})`);
    truckInput.value = "";
    if (data.added) {
      truckFormNote.textContent = data.lookupPending
        ? `Added ${data.truck}. Looking up driver on Webfleet…`
        : `Added ${data.truck}${data.driver ? ` · ${data.driver}` : ""}`;
    } else if (data.updated) {
      truckFormNote.textContent = `Updated ${data.truck}${data.driver ? ` · ${data.driver}` : ""}`;
    } else {
      truckFormNote.textContent = data.lookupPending
        ? `${data.truck} is already on the list. Refreshing driver from Webfleet…`
        : `${data.truck} is already on the list`;
    }
    if (data.restarted) truckFormNote.textContent += " · monitor restarting";
    await refresh({ force: true });
  } catch (error) {
    truckFormNote.textContent = error.message || String(error);
  } finally {
    truckInput.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
    truckInput.focus();
  }
});

async function removeTruck(truck) {
  const id = String(truck || "").trim();
  if (!id) return;
  const key = id.toUpperCase();
  if (removingTrucks.has(key)) return;
  removingTrucks.add(key);

  // Drop this row immediately and invalidate any in-flight poll paint.
  refreshGeneration += 1;
  const row = watchList.querySelector(`[data-remove="${cssEscape(id)}"]`)?.closest(".watch-row");
  if (row) row.remove();
  truckFormNote.textContent = `Removing ${id}…`;

  try {
    const res = await fetch(`/api/depot/trucks/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not remove truck");
    truckFormNote.textContent = data.removed
      ? `Removed ${data.truck}${data.restarted ? " · monitor restarting" : ""}`
      : `${id} was not on the list`;
    await refresh({ force: true });
  } catch (error) {
    truckFormNote.textContent = error.message || String(error);
    await refresh({ force: true });
  } finally {
    removingTrucks.delete(key);
  }
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

async function controlTask(action) {
  startBtn.disabled = true;
  stopBtn.disabled = true;
  try {
    const res = await fetch(`/api/tasks/depot-monitor/${action}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    await refresh({ force: true });
  } catch (error) {
    logView.textContent = `Error: ${error.message}`;
  } finally {
    startBtn.disabled = false;
    stopBtn.disabled = false;
  }
}

function renderTask(task) {
  const state = task?.running
    ? "running"
    : task?.status?.state || (task?.exitCode != null ? "stopped" : "idle");
  depotState.textContent = state;
  depotDot.className = `status-dot ${state}`;
  depotMessage.textContent = task?.status?.message || (task?.running ? "Running" : "Idle");
}

function renderLive(depot, configuredTrucks) {
  const driverMap = new Map(
    (configuredTrucks || []).map((entry) => [
      String(typeof entry === "string" ? entry : entry.id).toUpperCase(),
      typeof entry === "string" ? "" : entry.driver || "",
    ])
  );

  if (!depot) {
    depotSummary.textContent = "Start the monitor to populate live locations.";
    inDepotCount.textContent = "0";
    inDepotList.innerHTML = `<p class="empty-note">No live data yet.</p>`;
    allTruckList.innerHTML = "";
    watchedMeta.textContent = `${configuredTrucks.length} trucks configured`;
    return;
  }

  const inDepot = depot.inDepot || [];
  const trucks = depot.trucks || [];
  inDepotCount.textContent = String(depot.inDepotCount ?? inDepot.length);
  depotSummary.textContent =
    depot.message || `Cycle ${depot.cycle || 0} · updated ${formatTime(depot.updatedAt)}`;
  watchedMeta.textContent = `${trucks.length || configuredTrucks.length} trucks watched`;

  if (!inDepot.length) {
    inDepotList.innerHTML = `<p class="empty-note">No watched trucks currently match the depot.</p>`;
  } else {
    inDepotList.innerHTML = inDepot
      .map((row) => {
        const driver = driverMap.get(String(row.truckNumber).toUpperCase()) || "";
        const location = row.locationText || "In area";
        return `
      <div class="truck-row">
        <strong>${escapeHtml(row.truckNumber)}</strong>
        <span>${escapeHtml(driver ? `${driver} · ${location}` : location)}</span>
      </div>`;
      })
      .join("");
  }

  allTruckList.innerHTML = trucks
    .map((row) => {
      const driver = driverMap.get(String(row.truckNumber).toUpperCase()) || "";
      const location = row.locationText || "Waiting for location…";
      const line = driver ? `${driver} · ${location}` : location;
      return `
    <div class="truck-chip ${row.inTargetArea ? "in" : ""}">
      <strong>${escapeHtml(row.truckNumber)}</strong>
      <span>${escapeHtml(line)}</span>
    </div>`;
    })
    .join("");
}

function renderWatchList(trucks, liveRows = []) {
  truckCount.textContent = `${trucks.length} truck${trucks.length === 1 ? "" : "s"}`;
  const liveMap = new Map(
    (liveRows || []).map((row) => [String(row.truckNumber).toUpperCase(), row])
  );

  if (!trucks.length) {
    watchList.innerHTML = `<p class="empty-note">No trucks yet. Add one above.</p>`;
    return;
  }

  watchList.innerHTML = trucks
    .map((entry) => {
      const truck = typeof entry === "string" ? entry : entry.id;
      const driver = typeof entry === "string" ? "" : entry.driver || "";
      const live = liveMap.get(String(truck).toUpperCase());
      const metaParts = [];
      if (driver) metaParts.push(driver);
      if (live?.locationText) {
        metaParts.push(live.inTargetArea ? `In depot · ${live.locationText}` : live.locationText);
      } else if (!driver) {
        metaParts.push("Configured");
      }
      const busy = removingTrucks.has(String(truck).toUpperCase());
      return `
      <div class="watch-row ${live?.inTargetArea ? "in" : ""}">
        <div>
          <strong>${escapeHtml(truck)}</strong>
          <span>${escapeHtml(metaParts.join(" · "))}</span>
        </div>
        <button type="button" class="btn danger-btn" data-remove="${escapeAttr(truck)}" ${
          busy ? "disabled" : ""
        }>Remove</button>
      </div>`;
    })
    .join("");
}

async function refreshLogs() {
  try {
    const res = await fetch("/api/tasks/depot-monitor/logs?tail=120");
    const data = await res.json();
    logView.textContent = (data.lines || []).join("\n") || "No log lines yet.";
  } catch (error) {
    logView.textContent = `Could not load logs: ${error.message}`;
  }
}

async function refresh({ force = false } = {}) {
  const generation = force ? ++refreshGeneration : refreshGeneration + 1;
  if (!force) refreshGeneration = generation;

  const [healthRes, depotRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/depot"),
  ]);

  // A newer refresh (add/remove or later poll) won — discard this paint.
  if (generation !== refreshGeneration) return;

  const health = await healthRes.json();
  const depotPayload = await depotRes.json();
  if (generation !== refreshGeneration) return;

  const ip = (health.addresses && health.addresses[0]) || location.hostname;
  hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}/depot`;
  clockLine.textContent = new Date().toLocaleString();

  renderTask(depotPayload.task);
  renderLive(depotPayload.depot, depotPayload.trucks || []);
  renderWatchList(depotPayload.trucks || [], depotPayload.depot?.trucks || []);
  await refreshLogs();
}

function formatTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return value;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

refresh({ force: true });
setInterval(() => refresh(), 4000);
