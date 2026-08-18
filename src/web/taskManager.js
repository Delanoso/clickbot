import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readTaskStatus, runtimeDir, writeTaskStatus } from "../utils/taskStatus.js";

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
    name: "Depot Monitor",
    summary: "Watch trucks and alert when they enter Boksburg depot.",
    cli: "depot-monitor",
  },
  {
    id: "incidents-monitor",
    name: "Incidents and Drivers",
    summary: "Watch trucks for depot (green) and Johannesburg (yellow) with driver comments.",
    cli: "incidents-monitor",
  },
  {
    id: "wake-trucks",
    name: "Wake Trucks",
    summary: "Lytx Video Search — Wake/Retry all vehicles, report trucks still not Browse.",
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

  mkdirSync(runtimeDir, { recursive: true });
  // Start each task with a fresh log so the dashboard reflects the current
  // run instead of mixing output from older deployments/runs.
  writeFileSync(logPath(taskId), "");
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
