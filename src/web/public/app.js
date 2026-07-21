const taskPanels = [...document.querySelectorAll(".task-panel")];
const hostLine = document.getElementById("hostLine");
const clockLine = document.getElementById("clockLine");
const depotSummary = document.getElementById("depotSummary");
const inDepotCount = document.getElementById("inDepotCount");
const inDepotList = document.getElementById("inDepotList");
const allTruckList = document.getElementById("allTruckList");
const watchedMeta = document.getElementById("watchedMeta");
const logTabs = document.getElementById("logTabs");
const logView = document.getElementById("logView");

let selectedLogTask = "depot-monitor";

taskPanels.forEach((panel) => {
  panel.querySelector('[data-action="start"]').addEventListener("click", () => {
    controlTask(panel.dataset.task, "start");
  });
  panel.querySelector('[data-action="stop"]').addEventListener("click", () => {
    controlTask(panel.dataset.task, "stop");
  });
});

async function controlTask(taskId, action) {
  const panel = document.querySelector(`[data-task="${taskId}"]`);
  panel?.querySelectorAll("button").forEach((btn) => {
    btn.disabled = true;
  });
  try {
    const res = await fetch(`/api/tasks/${taskId}/${action}`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    selectedLogTask = taskId;
    renderTasks(data.task ? [data.task] : []);
    await refresh();
  } catch (error) {
    logView.textContent = `Error: ${error.message}`;
  } finally {
    panel?.querySelectorAll("button").forEach((btn) => {
      btn.disabled = false;
    });
  }
}

function renderTasks(tasks) {
  for (const task of tasks) {
    const panel = document.querySelector(`[data-task="${task.id}"]`);
    if (!panel) continue;
    const state = task.running
      ? "running"
      : task.status?.state || (task.exitCode != null ? "stopped" : "idle");
    panel.querySelector('[data-role="state"]').textContent = state;
    panel.querySelector('[data-role="dot"]').className = `status-dot ${state}`;

    let detail = "—";
    if (task.id === "allocate-drivers") {
      detail = task.status?.lastTruck
        ? `${task.status.lastTruck} → ${task.status.lastDriver || "?"}`
        : task.status?.message || "—";
    } else if (task.id === "fyi-notify") {
      detail =
        task.status?.remaining != null
          ? String(task.status.remaining)
          : task.status?.message || "—";
    } else if (task.id === "depot-monitor") {
      detail =
        task.status?.inDepotCount != null
          ? `${task.status.inDepotCount} / ${task.status.watchedCount || "?"}`
          : task.status?.message || "—";
    }
    panel.querySelector('[data-role="detail"]').textContent = detail;
  }

  logTabs.innerHTML = "";
  for (const task of tasks) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = task.name;
    btn.className = task.id === selectedLogTask ? "active" : "";
    btn.addEventListener("click", () => {
      selectedLogTask = task.id;
      refreshLogs();
      refresh();
    });
    logTabs.appendChild(btn);
  }
}

function renderDepot(depot) {
  if (!depot) {
    depotSummary.textContent = "Start Depot Monitor to populate this board.";
    inDepotCount.textContent = "0";
    inDepotList.innerHTML = `<p class="empty-note">No live data yet.</p>`;
    allTruckList.innerHTML = "";
    watchedMeta.textContent = "";
    return;
  }

  const inDepot = depot.inDepot || [];
  const trucks = depot.trucks || [];
  inDepotCount.textContent = String(depot.inDepotCount ?? inDepot.length);
  depotSummary.textContent =
    depot.message ||
    `Cycle ${depot.cycle || 0} · updated ${formatTime(depot.updatedAt)}`;
  watchedMeta.textContent = `${trucks.length || depot.watchedCount || 0} trucks watched`;

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

async function refreshLogs() {
  try {
    const res = await fetch(`/api/tasks/${selectedLogTask}/logs?tail=100`);
    const data = await res.json();
    logView.textContent = (data.lines || []).join("\n") || "No log lines yet.";
  } catch (error) {
    logView.textContent = `Could not load logs: ${error.message}`;
  }
}

async function refresh() {
  const [healthRes, tasksRes, depotRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/tasks"),
    fetch("/api/depot"),
  ]);
  const health = await healthRes.json();
  const tasksPayload = await tasksRes.json();
  const depotPayload = await depotRes.json();

  const ip = (health.addresses && health.addresses[0]) || "127.0.0.1";
  hostLine.textContent = `Open on your LAN: http://${ip}:${health.port}`;
  clockLine.textContent = new Date().toLocaleString();

  renderTasks(tasksPayload.tasks || []);
  renderDepot(depotPayload.depot);
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
