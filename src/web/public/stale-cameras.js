const hostLine = document.getElementById("hostLine");
const clockLine = document.getElementById("clockLine");
const staleDot = document.getElementById("staleDot");
const staleState = document.getElementById("staleState");
const staleMessage = document.getElementById("staleMessage");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const staleCount = document.getElementById("staleCount");
const pagesDetail = document.getElementById("pagesDetail");
const addedDetail = document.getElementById("addedDetail");
const resultDetail = document.getElementById("resultDetail");
const truckList = document.getElementById("truckList");
const copyBtn = document.getElementById("copyBtn");
const copyNote = document.getElementById("copyNote");
const staleList = document.getElementById("staleList");
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
  try {
    const res = await fetch(`/api/tasks/stale-cameras/${action}`, { method: "POST" });
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

function actionLabel(row) {
  if (row.added) return "Added";
  if (row.updated) return "Device updated";
  return "Already listed";
}

function renderStale(task) {
  const status = task?.status || {};
  const state = task?.running
    ? "running"
    : status.state || (task?.exitCode != null ? "stopped" : "idle");

  staleState.textContent = state;
  staleDot.className = `status-dot ${state}`;
  staleMessage.textContent =
    status.message || (task?.running ? "Scanning Last communicated…" : "Ready to scan Last communicated");

  const summary = status.summary || {};
  const trucks = summary.staleTrucks || status.staleTrucks || [];
  const csv = summary.copyPasteCsv || (trucks.length ? trucks.map((row) => row.vehicleId).join(", ") : "");
  const total = summary.staleCount ?? status.staleCount ?? trucks.length ?? 0;
  const added = summary.addedCount ?? status.added ?? 0;

  staleCount.textContent = String(total);
  pagesDetail.textContent =
    summary.pagesScanned ||
    (status.pagesScanned != null ? `${status.pagesScanned} of ${status.maxPages || "?"}` : "—");
  addedDetail.textContent = task?.running ? "…" : String(added);
  resultDetail.textContent = summary.dashboardMessage || status.message || "—";

  lastCsv = csv;
  if (csv) {
    truckList.textContent = `${csv}\n\nTotal stale trucks: ${total}`;
    copyBtn.disabled = false;
  } else if (task?.running) {
    truckList.textContent = "Scan running… list appears when finished.";
    copyBtn.disabled = true;
  } else {
    truckList.textContent = "Run a scan to list trucks older than 2 days.";
    copyBtn.disabled = true;
  }

  staleList.innerHTML = "";
  for (const row of trucks) {
    const el = document.createElement("div");
    el.className = `watch-row${row.added ? " in" : ""}`;
    const device = row.device || "no device";
    const last = row.lastCommunicated || "none";
    el.innerHTML = `<div><strong>${escapeHtml(row.vehicleId)}</strong><span>${escapeHtml(device)} · ${escapeHtml(last)} · ${escapeHtml(actionLabel(row))}</span></div>`;
    staleList.appendChild(el);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  const [healthRes, staleRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/stale-cameras"),
  ]);
  const health = await healthRes.json();
  const stale = await staleRes.json();

  const ip = (health.addresses && health.addresses[0]) || location.hostname;
  hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}/stale-cameras`;
  clockLine.textContent = new Date().toLocaleString();

  renderStale(stale.task);
  await refreshLogs();
}

refresh();
setInterval(refresh, 4000);
