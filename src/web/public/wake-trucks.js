const hostLine = document.getElementById("hostLine");
const clockLine = document.getElementById("clockLine");
const wakeDot = document.getElementById("wakeDot");
const wakeState = document.getElementById("wakeState");
const wakeMessage = document.getElementById("wakeMessage");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const wokenCount = document.getElementById("wokenCount");
const pagesDetail = document.getElementById("pagesDetail");
const resultDetail = document.getElementById("resultDetail");
const truckList = document.getElementById("truckList");
const copyBtn = document.getElementById("copyBtn");
const copyNote = document.getElementById("copyNote");
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
    const res = await fetch(`/api/tasks/wake-trucks/${action}`, { method: "POST" });
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

function renderWake(task) {
  const status = task?.status || {};
  const state = task?.running
    ? "running"
    : status.state || (task?.exitCode != null ? "stopped" : "idle");

  wakeState.textContent = state;
  wakeDot.className = `status-dot ${state}`;
  wakeMessage.textContent = status.message || (task?.running ? "Running Stage 1…" : "Ready for Stage 1");

  const summary = status.summary || {};
  const trucks = summary.clickedVehicles || status.clickedVehicles || [];
  const csv = summary.copyPasteCsv || (trucks.length ? trucks.join(", ") : "");
  const total = summary.totalClicks ?? status.clicked ?? trucks.length ?? 0;

  wokenCount.textContent = String(total);
  pagesDetail.textContent =
    summary.pagesScanned ||
    (status.pagesScanned != null
      ? `${status.pagesScanned} of ${status.maxPages || "?"}`
      : "—");
  resultDetail.textContent =
    summary.dashboardMessage || status.message || "—";

  lastCsv = csv;
  if (csv) {
    truckList.textContent = `${csv}\n\nTotal trucks woken: ${total}`;
    copyBtn.disabled = false;
  } else if (task?.running) {
    truckList.textContent = "Stage 1 running… truck list appears when finished.";
    copyBtn.disabled = true;
  } else {
    truckList.textContent = "Run Stage 1 to get the truck list.";
    copyBtn.disabled = true;
  }
}

async function refreshLogs() {
  try {
    const res = await fetch("/api/tasks/wake-trucks/logs?tail=150");
    const data = await res.json();
    logView.textContent = (data.lines || []).join("\n") || "No log lines yet.";
  } catch (error) {
    logView.textContent = `Could not load logs: ${error.message}`;
  }
}

async function refresh() {
  const [healthRes, tasksRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/tasks"),
  ]);
  const health = await healthRes.json();
  const tasksPayload = await tasksRes.json();
  const task = (tasksPayload.tasks || []).find((t) => t.id === "wake-trucks");

  const ip = (health.addresses && health.addresses[0]) || location.hostname;
  hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}/wake-trucks`;
  clockLine.textContent = new Date().toLocaleString();

  renderWake(task);
  await refreshLogs();
}

refresh();
setInterval(refresh, 4000);
