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

startBtn.addEventListener("click", () => controlTask("start"));
stopBtn.addEventListener("click", () => controlTask("stop"));

addTruckForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const truck = truckInput.value.trim();
  if (!truck) return;
  truckFormNote.textContent = "Saving…";
  try {
    const res = await fetch("/api/depot/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ truck }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not add truck");
    truckInput.value = "";
    truckFormNote.textContent = data.added
      ? `Added ${data.truck}${data.restarted ? " · monitor restarting" : ""}`
      : `${data.truck} is already on the list`;
    await refresh();
  } catch (error) {
    truckFormNote.textContent = error.message;
  }
});

async function removeTruck(truck) {
  truckFormNote.textContent = `Removing ${truck}…`;
  try {
    const res = await fetch(`/api/depot/trucks/${encodeURIComponent(truck)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not remove truck");
    truckFormNote.textContent = data.removed
      ? `Removed ${data.truck}${data.restarted ? " · monitor restarting" : ""}`
      : `${truck} was not on the list`;
    await refresh();
  } catch (error) {
    truckFormNote.textContent = error.message;
  }
}

async function controlTask(action) {
  startBtn.disabled = true;
  stopBtn.disabled = true;
  try {
    const res = await fetch(`/api/tasks/depot-monitor/${action}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    await refresh();
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
      .map(
        (row) => `
      <div class="truck-row">
        <strong>${escapeHtml(row.truckNumber)}</strong>
        <span>${escapeHtml(row.locationText || "In area")}</span>
      </div>`
      )
      .join("");
  }

  allTruckList.innerHTML = trucks
    .map(
      (row) => `
    <div class="truck-chip ${row.inTargetArea ? "in" : ""}">
      <strong>${escapeHtml(row.truckNumber)}</strong>
      <span>${escapeHtml(row.locationText || "Waiting for location…")}</span>
    </div>`
    )
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
    .map((truck) => {
      const live = liveMap.get(truck);
      const meta = live?.locationText
        ? live.inTargetArea
          ? `In depot · ${live.locationText}`
          : live.locationText
        : "Configured";
      return `
      <div class="watch-row ${live?.inTargetArea ? "in" : ""}">
        <div>
          <strong>${escapeHtml(truck)}</strong>
          <span>${escapeHtml(meta)}</span>
        </div>
        <button type="button" class="btn danger-btn" data-remove="${escapeHtml(truck)}">Remove</button>
      </div>`;
    })
    .join("");

  watchList.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeTruck(btn.getAttribute("data-remove")));
  });
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

async function refresh() {
  const [healthRes, depotRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/depot"),
  ]);
  const health = await healthRes.json();
  const depotPayload = await depotRes.json();

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

refresh();
setInterval(refresh, 4000);
