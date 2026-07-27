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

const stage2Dot = document.getElementById("stage2Dot");
const stage2State = document.getElementById("stage2State");
const stage2Message = document.getElementById("stage2Message");
const stage2StartBtn = document.getElementById("stage2StartBtn");
const stage2StopBtn = document.getElementById("stage2StopBtn");
const stage2DriverCount = document.getElementById("stage2DriverCount");
const stage2Progress = document.getElementById("stage2Progress");
const stage2List = document.getElementById("stage2List");
const exportBtn = document.getElementById("exportBtn");

let lastCsv = "";
let stage1TruckCount = 0;

startBtn.addEventListener("click", () => controlTask("start"));
stopBtn.addEventListener("click", () => controlTask("stop"));
stage2StartBtn.addEventListener("click", () => controlStage2("start"));
stage2StopBtn.addEventListener("click", () => controlStage2("stop"));
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

async function controlStage2(action) {
  stage2StartBtn.disabled = true;
  stage2StopBtn.disabled = true;
  try {
    const res = await fetch(`/api/wake-trucks/stage2/${action}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    await refresh();
  } catch (error) {
    stage2Progress.textContent = `Error: ${error.message}`;
  } finally {
    stage2StartBtn.disabled = false;
    stage2StopBtn.disabled = false;
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
  stage1TruckCount = trucks.length || total;

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

  stage2StartBtn.disabled = task?.running || stage1TruckCount === 0;
}

function renderStage2(stage2) {
  const s = stage2 || {};
  const state = s.state || "idle";
  stage2State.textContent = state;
  stage2Dot.className = `status-dot ${state}`;
  stage2Message.textContent = s.message || "Optional — run after Stage 1 when you need driver names";
  stage2DriverCount.textContent = String(s.withDriver || 0);

  if (s.total) {
    stage2Progress.textContent = `${s.done || 0} / ${s.total} looked up · ${s.withDriver || 0} with driver · ${s.pending || 0} pending`;
  } else {
    stage2Progress.textContent =
      stage1TruckCount > 0
        ? `${stage1TruckCount} woken truck(s) ready — press Start Stage 2 when you want driver names`
        : "Run Stage 1 first";
  }

  exportBtn.href = `/api/wake-trucks/stage2/export?t=${Date.now()}`;
  exportBtn.toggleAttribute("aria-disabled", !s.total);
  if (!s.total) exportBtn.classList.add("is-disabled");
  else exportBtn.classList.remove("is-disabled");

  stage2List.innerHTML = "";
  for (const row of s.trucks || []) {
    const el = document.createElement("div");
    el.className = `watch-row${row.driver ? " in" : ""}`;
    const driverText =
      row.driver ||
      (row.status === "looking"
        ? "Looking up…"
        : row.status === "pending"
          ? "Queued…"
          : row.status === "no_driver"
            ? "No driver"
            : row.error || row.status);
    el.innerHTML = `<div><strong>${escapeHtml(row.truck)}</strong><span>${escapeHtml(driverText)}</span></div>`;
    stage2List.appendChild(el);
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
    const res = await fetch("/api/tasks/wake-trucks/logs?tail=150");
    const data = await res.json();
    logView.textContent = (data.lines || []).join("\n") || "No log lines yet.";
  } catch (error) {
    logView.textContent = `Could not load logs: ${error.message}`;
  }
}

async function refresh() {
  const [healthRes, wakeRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/wake-trucks"),
  ]);
  const health = await healthRes.json();
  const wake = await wakeRes.json();

  const ip = (health.addresses && health.addresses[0]) || location.hostname;
  hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}/wake-trucks`;
  clockLine.textContent = new Date().toLocaleString();

  if (Array.isArray(wake.stage1Trucks)) {
    stage1TruckCount = wake.stage1Trucks.length;
  }
  renderWake(wake.task);
  renderStage2(wake.stage2);
  await refreshLogs();
}

refresh();
setInterval(refresh, 4000);
