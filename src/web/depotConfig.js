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

function normalizeTruck(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function uniqueTrucks(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const truck = normalizeTruck(item);
    if (!truck || seen.has(truck)) continue;
    seen.add(truck);
    out.push(truck);
  }
  return out;
}

export function readDepotConfig(configPath = DEFAULT_CONFIG) {
  const path = resolveConfigPath(configPath);
  if (!existsSync(path)) {
    throw new Error(`Config not found: ${path}`);
  }
  const config = loadJson(path);
  const monitor = config.depotMonitor || {};
  return {
    path,
    config,
    trucks: uniqueTrucks(monitor.trucks || []),
    targetArea: monitor.targetArea || "",
    targetAreas: monitor.targetAreas || [],
    pollIntervalMs: monitor.pollIntervalMs ?? 60000,
  };
}

export function listDepotTrucks(configPath = DEFAULT_CONFIG) {
  return readDepotConfig(configPath).trucks;
}

export function addDepotTruck(truckNumber, configPath = DEFAULT_CONFIG) {
  const truck = normalizeTruck(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  const current = readDepotConfig(configPath);
  if (current.trucks.includes(truck)) {
    return { trucks: current.trucks, added: false, truck };
  }

  const trucks = [...current.trucks, truck];
  current.config.depotMonitor = {
    ...(current.config.depotMonitor || {}),
    trucks,
  };
  saveJson(current.path, current.config);
  return { trucks, added: true, truck };
}

export function removeDepotTruck(truckNumber, configPath = DEFAULT_CONFIG) {
  const truck = normalizeTruck(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  const current = readDepotConfig(configPath);
  const trucks = current.trucks.filter((item) => item !== truck);
  if (trucks.length === current.trucks.length) {
    return { trucks: current.trucks, removed: false, truck };
  }

  current.config.depotMonitor = {
    ...(current.config.depotMonitor || {}),
    trucks,
  };
  saveJson(current.path, current.config);
  return { trucks, removed: true, truck };
}

export function setDepotTrucks(truckNumbers, configPath = DEFAULT_CONFIG) {
  const trucks = uniqueTrucks(truckNumbers);
  const current = readDepotConfig(configPath);
  current.config.depotMonitor = {
    ...(current.config.depotMonitor || {}),
    trucks,
  };
  saveJson(current.path, current.config);
  return { trucks };
}
