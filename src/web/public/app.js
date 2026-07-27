const hostLine = document.getElementById("hostLine");
const clockLine = document.getElementById("clockLine");
const logTabs = document.getElementById("logTabs");
const logView = document.getElementById("logView");
const depotDot = document.getElementById("depotDot");
const depotState = document.getElementById("depotState");
const depotDetail = document.getElementById("depotDetail");
const wakeDot = document.getElementById("wakeDot");
const wakeState = document.getElementById("wakeState");
const wakeDetail = document.getElementById("wakeDetail");

let selectedLogTask = "allocate-drivers";

document.querySelectorAll(".task-panel[data-task]").forEach((panel) => {
  panel.querySelector('[data-action="start"]')?.addEventListener("click", () => {
    controlTask(panel.dataset.task, "start");
  });
  panel.querySelector('[data-action="stop"]')?.addEventListener("click", () => {
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
    if (task.id === "depot-monitor") {
      const state = task.running
        ? "running"
        : task.status?.state || (task.exitCode != null ? "stopped" : "idle");
      depotState.textContent = state;
      depotDot.className = `status-dot ${state}`;
      depotDetail.textContent =
        task.status?.inDepotCount != null
          ? `${task.status.inDepotCount} / ${task.status.watchedCount || "?"}`
          : task.status?.message || "—";
      continue;
    }

    if (task.id === "wake-trucks") {
      const state = task.running
        ? "running"
        : task.status?.state || (task.exitCode != null ? "stopped" : "idle");
      wakeState.textContent = state;
      wakeDot.className = `status-dot ${state}`;
      wakeDetail.textContent =
        task.status?.summary?.dashboardMessage ||
        (task.status?.clicked != null
          ? `${task.status.clicked} woken`
          : task.status?.message || "—");
      continue;
    }

    if (task.id === "incidents-monitor") continue;

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
    } else if (task.id === "fyi-notify" || task.id === "due-for-coaching") {
      detail =
        task.status?.remaining != null
          ? String(task.status.remaining)
          : task.status?.message || "—";
    }
    panel.querySelector('[data-role="detail"]').textContent = detail;
  }

  const homeTasks = tasks.filter(
    (task) =>
      task.id !== "depot-monitor" &&
      task.id !== "incidents-monitor" &&
      task.id !== "wake-trucks"
  );
  logTabs.innerHTML = "";
  for (const task of homeTasks) {
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
  const [healthRes, tasksRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/tasks"),
  ]);
  const health = await healthRes.json();
  const tasksPayload = await tasksRes.json();

  const ip = (health.addresses && health.addresses[0]) || location.hostname;
  hostLine.textContent = `http://${ip}${location.port ? `:${location.port}` : ""}`;
  clockLine.textContent = new Date().toLocaleString();

  renderTasks(tasksPayload.tasks || []);
  await refreshLogs();
}

refresh();
setInterval(refresh, 4000);
