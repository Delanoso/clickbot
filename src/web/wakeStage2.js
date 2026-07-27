/**
 * In-memory Stage 2 state for Wake Trucks.
 * Cleared whenever Stage 1 starts again — nothing is persisted long-term.
 */

const rows = new Map();
let state = "idle"; // idle | running | done | stopped | error
let message = "Optional — run after Stage 1 when you need driver names";
let startedAt = null;
let finishedAt = null;
let cancelled = false;

export function getWakeStage2() {
  const list = [...rows.values()].sort((a, b) => a.truck.localeCompare(b.truck));
  const done = list.filter((r) => r.status === "done" || r.status === "error" || r.status === "no_driver").length;
  const pending = list.filter((r) => r.status === "pending" || r.status === "looking").length;
  const withDriver = list.filter((r) => r.driver).length;
  return {
    state,
    message,
    startedAt,
    finishedAt,
    total: list.length,
    done,
    pending,
    withDriver,
    trucks: list,
  };
}

export function clearWakeStage2(reason = "Cleared for new Stage 1 run") {
  cancelled = true;
  rows.clear();
  state = "idle";
  message = reason;
  startedAt = null;
  finishedAt = null;
  return getWakeStage2();
}

/**
 * Seed Stage 2 from Stage 1 woken truck IDs and begin lookups.
 */
export function startWakeStage2(truckIds = []) {
  const trucks = [
    ...new Set(
      (truckIds || [])
        .map((t) => String(t || "").trim().toUpperCase())
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));

  if (!trucks.length) {
    throw new Error("No woken trucks from Stage 1 — run Stage 1 first");
  }

  cancelled = false;
  rows.clear();
  for (const truck of trucks) {
    rows.set(truck, {
      truck,
      driver: "",
      status: "pending",
      error: null,
      updatedAt: new Date().toISOString(),
    });
  }
  state = "running";
  message = `Looking up drivers for ${trucks.length} truck(s)…`;
  startedAt = new Date().toISOString();
  finishedAt = null;
  return getWakeStage2();
}

export function stopWakeStage2() {
  cancelled = true;
  for (const row of rows.values()) {
    if (row.status === "pending" || row.status === "looking") {
      row.status = "stopped";
      row.updatedAt = new Date().toISOString();
    }
  }
  state = "stopped";
  message = "Stage 2 stopped";
  finishedAt = new Date().toISOString();
  return getWakeStage2();
}

export function isWakeStage2Cancelled() {
  return cancelled;
}

export function markWakeStage2Looking(truck) {
  const id = String(truck || "").trim().toUpperCase();
  const row = rows.get(id);
  if (!row) return null;
  row.status = "looking";
  row.updatedAt = new Date().toISOString();
  return row;
}

export function setWakeStage2Driver(truck, driver) {
  const id = String(truck || "").trim().toUpperCase();
  const row = rows.get(id);
  if (!row) return null;
  row.driver = String(driver || "").trim();
  row.status = row.driver ? "done" : "no_driver";
  row.error = null;
  row.updatedAt = new Date().toISOString();
  maybeFinish();
  return row;
}

export function setWakeStage2Error(truck, error) {
  const id = String(truck || "").trim().toUpperCase();
  const row = rows.get(id);
  if (!row) return null;
  row.status = "error";
  row.error = String(error?.message || error || "Lookup failed");
  row.updatedAt = new Date().toISOString();
  maybeFinish();
  return row;
}

function maybeFinish() {
  if (state !== "running") return;
  const list = [...rows.values()];
  const pending = list.some((r) => r.status === "pending" || r.status === "looking");
  if (pending) return;
  state = "done";
  const withDriver = list.filter((r) => r.driver).length;
  message = `Done — ${withDriver} of ${list.length} with driver names`;
  finishedAt = new Date().toISOString();
}

export function buildWakeStage2ExportCsv() {
  const list = getWakeStage2().trucks;
  const lines = ["Truck,Driver,Status"];
  for (const row of list) {
    lines.push(
      [csvEscape(row.truck), csvEscape(row.driver), csvEscape(statusLabel(row))].join(",")
    );
  }
  // BOM so Excel opens UTF-8 correctly
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function statusLabel(row) {
  if (row.driver) return "ok";
  if (row.status === "looking" || row.status === "pending") return row.status;
  if (row.status === "no_driver") return "no driver";
  if (row.status === "error") return row.error || "error";
  if (row.status === "stopped") return "stopped";
  return row.status;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
