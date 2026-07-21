import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

export function normalizeTruckId(value) {
  if (value && typeof value === "object") {
    return normalizeTruckId(value.id || value.truck || value.truckNumber || "");
  }
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function normalizeTruckEntry(value) {
  if (value && typeof value === "object") {
    const id = normalizeTruckId(value.id || value.truck || value.truckNumber || "");
    if (!id) return null;
    return {
      id,
      driver: String(value.driver || value.driverName || "").trim(),
    };
  }
  const id = normalizeTruckId(value);
  if (!id) return null;
  return { id, driver: "" };
}

export function normalizeTruckEntries(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const entry = normalizeTruckEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

export function truckIdsFromEntries(entries) {
  return normalizeTruckEntries(entries).map((entry) => entry.id);
}

export function readDepotConfig(configPath = DEFAULT_CONFIG) {
  const path = resolveConfigPath(configPath);
  if (!existsSync(path)) {
    throw new Error(`Config not found: ${path}`);
  }
  const config = loadJson(path);
  const monitor = config.depotMonitor || {};
  const trucks = normalizeTruckEntries(monitor.trucks || []);
  return {
    path,
    config,
    trucks,
    truckIds: trucks.map((entry) => entry.id),
    targetArea: monitor.targetArea || "",
    targetAreas: monitor.targetAreas || [],
    pollIntervalMs: monitor.pollIntervalMs ?? 60000,
  };
}

export function listDepotTrucks(configPath = DEFAULT_CONFIG) {
  return readDepotConfig(configPath).trucks;
}

function saveTruckEntries(current, trucks) {
  current.config.depotMonitor = {
    ...(current.config.depotMonitor || {}),
    trucks,
  };
  saveJson(current.path, current.config);
}

export function addDepotTruck(
  truckNumber,
  { driver = "", configPath = DEFAULT_CONFIG } = {}
) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");
  const driverName = String(driver || "").trim();

  const current = readDepotConfig(configPath);
  const existing = current.trucks.find((entry) => entry.id === truck);
  if (existing) {
    if (driverName && existing.driver !== driverName) {
      existing.driver = driverName;
      saveTruckEntries(current, current.trucks);
      return { trucks: current.trucks, added: false, updated: true, truck, driver: driverName };
    }
    return {
      trucks: current.trucks,
      added: false,
      updated: false,
      truck,
      driver: existing.driver || "",
    };
  }

  const trucks = [...current.trucks, { id: truck, driver: driverName }];
  saveTruckEntries(current, trucks);
  return { trucks, added: true, updated: false, truck, driver: driverName };
}

export function removeDepotTruck(truckNumber, configPath = DEFAULT_CONFIG) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  const current = readDepotConfig(configPath);
  const trucks = current.trucks.filter((entry) => entry.id !== truck);
  if (trucks.length === current.trucks.length) {
    return { trucks: current.trucks, removed: false, truck };
  }

  saveTruckEntries(current, trucks);
  return { trucks, removed: true, truck };
}

/**
 * Update driver for an existing truck only — never re-adds a removed truck.
 */
export function setDepotTruckDriver(
  truckNumber,
  driver,
  configPath = DEFAULT_CONFIG
) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  const current = readDepotConfig(configPath);
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
}

export function setDepotTrucks(truckNumbers, configPath = DEFAULT_CONFIG) {
  const current = readDepotConfig(configPath);
  const previous = new Map(current.trucks.map((entry) => [entry.id, entry.driver]));
  const trucks = normalizeTruckEntries(truckNumbers).map((entry) => ({
    id: entry.id,
    driver: entry.driver || previous.get(entry.id) || "",
  }));
  saveTruckEntries(current, trucks);
  return { trucks };
}
