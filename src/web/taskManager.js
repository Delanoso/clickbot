import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readTaskStatus, runtimeDir, writeTaskStatus } from "../utils/taskStatus.js";
import { clearWakeStage2 } from "./wakeStage2.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const TASKS = [
  {
    id: "allocate-drivers",
    name: "Allocate Drivers",
    summary: "Assign Webfleet driver Nos to Lytx unassigned vehicles.",
    cli: "allocate-drivers",
  },
  {
    id: "fyi-notify",
    name: "FYI Notify",
    summary: "Clear Lytx FYI Notify queue (Preview → Resolve → Confirm).",
    cli: "fyi-notify",
  },
  {
    id: "due-for-coaching",
    name: "Due for Coaching",
    summary: "Clear Lytx Due for Coaching (play clips → Complete Session).",
    cli: "due-for-coaching",
  },
  {
    id: "depot-monitor",
    name: "Driver PPE",
    summary: "PPE tracking — watch trucks and alert when they enter Boksburg depot.",
    cli: "depot-monitor",
  },
  {
    id: "incidents-monitor",
    name: "Driver Incident",
    summary: "Incident tracking — depot (green) and Johannesburg (yellow) with comments.",
    cli: "incidents-monitor",
  },
  {
    id: "camera-monitor",
    name: "Truck Camera",
    summary: "Camera tracking — trucks with cameras not working (depot + Johannesburg).",
    cli: "camera-monitor",
  },
  {
    id: "wake-trucks",
    name: "Wake Trucks",
    summary: "Lytx Video Search — one pass Wake/Retry all pages, run summary in logs.",
    cli: "wake-trucks",
  },
];

const processes = new Map();

function logPath(taskId) {
  return join(runtimeDir, `${taskId}.log`);
}

export function listTasks() {
  return TASKS.map((task) => {
    const proc = processes.get(task.id);
    const fileStatus = readTaskStatus(task.id);
    const running = Boolean(proc && !proc.killed && proc.exitCode == null);
    return {
      ...task,
      running,
      pid: running ? proc.pid : null,
      startedAt: proc?.startedAt || null,
      exitCode: proc?.exitCode ?? null,
      status: fileStatus,
    };
  });
}

export function getTask(taskId) {
  return listTasks().find((task) => task.id === taskId) || null;
}

export function startTask(taskId, { configPath = "config/local.json" } = {}) {
  const meta = TASKS.find((task) => task.id === taskId);
  if (!meta) throw new Error(`Unknown task: ${taskId}`);

  const existing = processes.get(taskId);
  if (existing && existing.exitCode == null && !existing.killed) {
    return getTask(taskId);
  }

  if (taskId === "wake-trucks") {
    // Stage 2 is session-only — a new Stage 1 run clears it.
    clearWakeStage2("Cleared — Stage 1 started");
  }

  mkdirSync(runtimeDir, { recursive: true });
  const out = createWriteStream(logPath(taskId), { flags: "a" });
  const child = spawn(
    process.execPath,
    ["src/index.js", meta.cli, "--config", configPath],
    {
      cwd: root,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.startedAt = new Date().toISOString();
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.stdout.on("data", (chunk) => appendRecent(taskId, chunk));
  child.stderr.on("data", (chunk) => appendRecent(taskId, chunk));

  child.on("exit", (code) => {
    child.exitCode = code;
    const prev = readTaskStatus(taskId);
    if (prev?.state === "done" || prev?.state === "error") {
      writeTaskStatus(taskId, {
        ...prev,
        exitCode: code,
      });
      return;
    }
    writeTaskStatus(taskId, {
      state: "stopped",
      exitCode: code,
      message: `Process exited with code ${code}`,
    });
  });

  processes.set(taskId, child);
  writeTaskStatus(taskId, {
    state: "running",
    message: "Started from dashboard",
    pid: child.pid,
  });

  return getTask(taskId);
}

export function stopTask(taskId) {
  const child = processes.get(taskId);
  if (!child || child.exitCode != null) {
    writeTaskStatus(taskId, {
      state: "stopped",
      message: "Not running",
    });
    return getTask(taskId);
  }

  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode == null) child.kill("SIGKILL");
  }, 4000).unref?.();

  writeTaskStatus(taskId, {
    state: "stopping",
    message: "Stop requested from dashboard",
  });
  return getTask(taskId);
}

const recentLogs = new Map();

function appendRecent(taskId, chunk) {
  const text = String(chunk);
  const prev = recentLogs.get(taskId) || "";
  const next = (prev + text).slice(-20000);
  recentLogs.set(taskId, next);
}

export function readTaskLog(taskId, { tail = 120 } = {}) {
  const memory = recentLogs.get(taskId) || "";
  const path = logPath(taskId);
  let fileText = "";
  if (existsSync(path)) {
    try {
      fileText = readFileSync(path, "utf8");
    } catch {
      fileText = "";
    }
  }
  const combined = `${fileText}\n${memory}`.replace(/\u0007/g, "");
  const lines = combined.split(/\r?\n/).filter((line) => line.length);
  return lines.slice(-Math.max(1, Number(tail) || 120));
}

export function getDepotSnapshot() {
  return readTaskStatus("depot-monitor");
}

export function getIncidentsSnapshot() {
  return readTaskStatus("incidents-monitor");
}

export function getCameraSnapshot() {
  return readTaskStatus("camera-monitor");
}
