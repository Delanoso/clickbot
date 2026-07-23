import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTruckId } from "./depotConfig.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_CONFIG = "config/local.json";

function resolveConfigPath(configPath = DEFAULT_CONFIG) {
  return configPath.startsWith("/") ? configPath : join(root, configPath);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* serialize truck-list writes */
  }
}

function withConfigLock(configPath, fn) {
  const path = resolveConfigPath(configPath);
  const lockPath = `${path}.lock`;
  const started = Date.now();
  let fd;
  while (fd == null) {
    try {
      fd = openSync(lockPath, "wx");
      writeFileSync(fd, `${process.pid}\n`);
    } catch (error) {
      if (error && error.code !== "EEXIST") throw error;
      if (Date.now() - started > 15000) {
        throw new Error(`Timed out waiting for config lock: ${lockPath}`);
      }
      try {
        if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 120000) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        /* ignore */
      }
      sleepSync(40);
    }
  }
  try {
    return fn(path);
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

export function normalizeIncidentsTruckEntry(value) {
  if (value && typeof value === "object") {
    const id = normalizeTruckId(value.id || value.truck || value.truckNumber || "");
    if (!id) return null;
    return {
      id,
      driver: String(value.driver || value.driverName || "").trim(),
      comment: String(value.comment || "").trim(),
    };
  }
  const id = normalizeTruckId(value);
  if (!id) return null;
  return { id, driver: "", comment: "" };
}

export function normalizeIncidentsTruckEntries(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const entry = normalizeIncidentsTruckEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

export function incidentsTruckIds(entries) {
  return normalizeIncidentsTruckEntries(entries).map((entry) => entry.id);
}

export function readIncidentsConfig(configPath = DEFAULT_CONFIG) {
  const path = resolveConfigPath(configPath);
  if (!existsSync(path)) {
    throw new Error(`Config not found: ${path}`);
  }
  const config = loadJson(path);
  const section = config.incidentsDrivers || {};
  // Fully separate from depotMonitor.trucks — never seed or sync from depot.
  const trucks = normalizeIncidentsTruckEntries(section.trucks || []);

  return {
    path,
    config,
    trucks,
    truckIds: trucks.map((entry) => entry.id),
    pollIntervalMs: section.pollIntervalMs ?? 60000,
  };
}

export function listIncidentsTrucks(configPath = DEFAULT_CONFIG) {
  return readIncidentsConfig(configPath).trucks;
}

function saveTruckEntries(current, trucks) {
  const latest = loadJson(current.path);
  latest.incidentsDrivers = {
    ...(latest.incidentsDrivers || {}),
    trucks,
  };
  saveJson(current.path, latest);
  current.config = latest;
  current.trucks = trucks;
}

export function addIncidentsTruck(
  truckNumber,
  { driver = "", comment = "", configPath = DEFAULT_CONFIG } = {}
) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");
  const driverName = String(driver || "").trim();
  const commentText = String(comment || "").trim();

  return withConfigLock(configPath, () => {
    const current = readIncidentsConfig(configPath);
    const existing = current.trucks.find((entry) => entry.id === truck);
    if (existing) {
      let updated = false;
      if (driverName && existing.driver !== driverName) {
        existing.driver = driverName;
        updated = true;
      }
      if (commentText && existing.comment !== commentText) {
        existing.comment = commentText;
        updated = true;
      }
      if (updated) saveTruckEntries(current, current.trucks);
      return {
        trucks: current.trucks,
        added: false,
        updated,
        truck,
        driver: existing.driver || "",
        comment: existing.comment || "",
      };
    }

    const trucks = [
      ...current.trucks,
      { id: truck, driver: driverName, comment: commentText },
    ];
    saveTruckEntries(current, trucks);
    return {
      trucks,
      added: true,
      updated: false,
      truck,
      driver: driverName,
      comment: commentText,
    };
  });
}

export function removeIncidentsTruck(truckNumber, configPath = DEFAULT_CONFIG) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  return withConfigLock(configPath, () => {
    const current = readIncidentsConfig(configPath);
    const trucks = current.trucks.filter((entry) => entry.id !== truck);
    if (trucks.length === current.trucks.length) {
      return { trucks: current.trucks, removed: false, truck };
    }
    saveTruckEntries(current, trucks);
    return { trucks, removed: true, truck };
  });
}

export function setIncidentsTruckDriver(
  truckNumber,
  driver,
  configPath = DEFAULT_CONFIG
) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  return withConfigLock(configPath, () => {
    const current = readIncidentsConfig(configPath);
    const existing = current.trucks.find((entry) => entry.id === truck);
    if (!existing) {
      return { updated: false, truck, driver: "", missing: true };
    }
    const driverName = String(driver || "").trim();
    if (existing.driver === driverName) {
      return { updated: false, truck, driver: existing.driver, missing: false };
    }
    existing.driver = driverName;
    saveTruckEntries(current, current.trucks);
    return { updated: true, truck, driver: driverName, missing: false };
  });
}

export function setIncidentsTruckComment(
  truckNumber,
  comment,
  configPath = DEFAULT_CONFIG
) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  return withConfigLock(configPath, () => {
    const current = readIncidentsConfig(configPath);
    const existing = current.trucks.find((entry) => entry.id === truck);
    if (!existing) {
      return { updated: false, truck, comment: "", missing: true };
    }
    const commentText = String(comment || "").trim();
    if (existing.comment === commentText) {
      return { updated: false, truck, comment: existing.comment, missing: false };
    }
    existing.comment = commentText;
    saveTruckEntries(current, current.trucks);
    return { updated: true, truck, comment: commentText, missing: false };
  });
}

export function setIncidentsTrucks(truckNumbers, configPath = DEFAULT_CONFIG) {
  return withConfigLock(configPath, () => {
    const current = readIncidentsConfig(configPath);
    const previous = new Map(
      current.trucks.map((entry) => [entry.id, { driver: entry.driver, comment: entry.comment }])
    );
    const trucks = normalizeIncidentsTruckEntries(truckNumbers).map((entry) => ({
      id: entry.id,
      driver: entry.driver || previous.get(entry.id)?.driver || "",
      comment: entry.comment || previous.get(entry.id)?.comment || "",
    }));
    saveTruckEntries(current, trucks);
    return { trucks };
  });
}
