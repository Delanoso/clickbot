import { cameraMarkBadgeHtml, escapeHtml } from "./tracking-shared.js";

const hostLine = document.getElementById("hostLine");
const clockLine = document.getElementById("clockLine");
const staleDot = document.getElementById("staleDot");
const staleState = document.getElementById("staleState");
const staleMessage = document.getElementById("staleMessage");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const staleCount = document.getElementById("staleCount");
const pagesDetail = document.getElementById("pagesDetail");
const unavailableDetail = document.getElementById("unavailableDetail");
const oldDateDetail = document.getElementById("oldDateDetail");
const addedDetail = document.getElementById("addedDetail");
const removedDetail = document.getElementById("removedDetail");
const truckList = document.getElementById("truckList");
const copyBtn = document.getElementById("copyBtn");
const copyNote = document.getElementById("copyNote");
const unavailableList = document.getElementById("unavailableList");
const staleDateList = document.getElementById("staleDateList");
const logView = document.getElementById("logView");

let lastCsv = "";

startBtn.addEventListener("click", () => controlTask("start"));
stopBtn.addEventListener("click", () => controlTask("stop"));
copyBtn.addEventListener("click", async () => {
  if (!lastCsv) return;
  try {
    await navigator.clipboard.writeText(lastCsv);
    copyNote.textContent = "Copied to clipboard";
  } catch {
    copyNote.textContent = "Could not copy — select the list and copy manually";
  }
});

async function controlTask(action) {
  startBtn.disabled = true;
  stopBtn.disabled = true;

  // Give immediate feedback instead of waiting for the next polling tick.
  if (action === "start") {
    staleState.textContent = "running";
    staleDot.className = "status-dot running";
    staleMessage.textContent = "Starting scan…";
  } else if (action === "stop") {
    staleState.textContent = "stopped";
    staleDot.className = "status-dot stopped";
    staleMessage.textContent = "Stopping…";
  }

  try {
    const res = await fetch(`/api/tasks/stale-cameras/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      // Non-JSON response (rare, but keep UI error readable)
      data = { error: `HTTP ${res.status}` };
    }

    if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);

    // Refresh once right away; then again shortly after to avoid rare races
    // where the task status file updates slightly later than this request.
    await refresh();
    await new Promise((resolve) => setTimeout(resolve, 750));
    await refresh();
  } catch (error) {
    logView.textContent = `Error: ${error.message}`;
    staleState.textContent = "error";
    staleDot.className = "status-dot error";
    staleMessage.textContent = error.message || "Error starting scan";
  } finally {
    startBtn.disabled = false;
    stopBtn.disabled = false;
  }
}

function actionLabel(row) {
  if (row.added) return "Added";
  if (row.updated) return "Updated";
  return "Already listed";
}

function renderHitList(el, rows, emptyMessage) {
  if (!rows.length) {
    el.innerHTML = `<p class="empty-note">${escapeHtml(emptyMessage)}</p>`;
    return;
  }
  el.innerHTML = rows
    .map((row) => {
      const device = row.device || "no device";
      const last = row.lastCommunicated || "none";
      return `<div class="watch-row${row.added ? " in" : ""}">
        <div>
          <strong>${escapeHtml(row.vehicleId)} ${cameraMarkBadgeHtml(row.mark)}</strong>
          <span>${escapeHtml(device)} · ${escapeHtml(last)} · ${escapeHtml(actionLabel(row))}</span>
        </div>
      </div>`;
    })
    .join("");
}

function renderStale(task) {
  const status = task?.status || {};
  const state = task?.running
    ? "running"
    : status.state || (task?.exitCode != null ? "stopped" : "idle");

  staleState.textContent = state;
  staleDot.className = `status-dot ${state}`;
  staleMessage.textContent =
    status.message || (task?.running ? "Scanning Vehicles…" : "Ready to scan Last communicated");

  const summary = status.summary || {};
  const trucks = summary.staleTrucks || status.staleTrucks || [];
  const unavailable = trucks.filter((row) => row.mark === "not_available");
  const oldDates = trucks.filter((row) => row.mark !== "not_available");
  const csv = summary.copyPasteCsv || "";
  const total = summary.staleCount ?? status.staleCount ?? trucks.length ?? 0;
  const added = summary.addedCount ?? status.added ?? 0;
  const removed = summary.removedCount ?? status.removed ?? 0;
  const unavailableCount =
    summary.notAvailableCount ?? status.notAvailableCount ?? unavailable.length;
  const oldDateCount = summary.staleDateCount ?? status.staleDateCount ?? oldDates.length;

  staleCount.textContent = String(total);
  pagesDetail.textContent =
    summary.pagesScanned ||
    (status.pagesScanned != null ? `${status.pagesScanned} of ${status.maxPages || "?"}` : "—");
  unavailableDetail.textContent = task?.running ? "…" : String(unavailableCount);
  oldDateDetail.textContent = task?.running ? "…" : String(oldDateCount);
  addedDetail.textContent = task?.running ? "…" : String(added);
  removedDetail.textContent = task?.running ? "…" : String(removed);

  lastCsv = csv;
  if (csv) {
    truckList.textContent = csv;
    copyBtn.disabled = false;
  } else if (task?.running) {
    truckList.textContent = "Scan running… lists appear when finished.";
    copyBtn.disabled = true;
  } else {
    truckList.textContent = "Run a scan to list not-available and old-date trucks.";
    copyBtn.disabled = true;
  }

  renderHitList(
    unavailableList,
    unavailable,
    task?.running ? "Scanning…" : "No Not available trucks this run."
  );
  renderHitList(
    staleDateList,
    oldDates,
    task?.running ? "Scanning…" : "No working cameras from 2 days ago or earlier this run."
  );
}

async function refreshLogs() {
  try {
    const res = await fetch("/api/tasks/stale-cameras/logs?tail=150");
    const data = await res.json();
    logView.textContent = (data.lines || []).join("\n") || "No log lines yet.";
  } catch (error) {
    logView.textContent = `Could not load logs: ${error.message}`;
  }
}

async function refresh() {
  // We avoid Promise.all here so /api/health failures don’t block UI updates.
  try {
    const [healthRes, staleRes] = await Promise.allSettled([
      fetch("/api/health"),
      fetch("/api/stale-cameras"),
    ]);

    const health =
      healthRes.status === "fulfilled" ? await healthRes.value.json().catch(() => null) : null;
    const stale =
      staleRes.status === "fulfilled" ? await staleRes.value.json().catch(() => null) : null;

    const ip = (health?.addresses && health.addresses[0]) || location.hostname;
    hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}/stale-cameras`;
    clockLine.textContent = new Date().toLocaleString();

    if (stale?.task) {
      renderStale(stale.task);
    } else {
      // Keep the UI usable even if /api/stale-cameras failed to decode.
      staleState.textContent = "error";
      staleDot.className = "status-dot error";
      staleMessage.textContent = "Could not load stale-cameras status";
    }

    await refreshLogs();
  } catch (error) {
    // Last-resort: update the header + show an error state so users know polling is broken.
    const ip = location.hostname;
    hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}/stale-cameras`;
    staleState.textContent = "error";
    staleDot.className = "status-dot error";
    staleMessage.textContent = `UI refresh failed`;
  }
}

refresh();
setInterval(refresh, 4000);
