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
import {
  cameraMarkComment,
  isAutoCameraComment,
  normalizeCameraMark,
  preferCameraMark,
} from "./cameraMarks.js";

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

export function normalizeCameraTruckEntry(value) {
  if (value && typeof value === "object") {
    const id = normalizeTruckId(value.id || value.truck || value.truckNumber || "");
    if (!id) return null;
    return {
      id,
      driver: String(value.driver || value.driverName || "").trim(),
      comment: String(value.comment || "").trim(),
      device: String(value.device || value.deviceNumber || "").trim(),
      mark: normalizeCameraMark(value.mark || value.cameraMark || value.issue || ""),
    };
  }
  const id = normalizeTruckId(value);
  if (!id) return null;
  return { id, driver: "", comment: "", device: "", mark: "" };
}

export function normalizeCameraTruckEntries(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const entry = normalizeCameraTruckEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

export function cameraTruckIds(entries) {
  return normalizeCameraTruckEntries(entries).map((entry) => entry.id);
}

export function readCameraConfig(configPath = DEFAULT_CONFIG) {
  const path = resolveConfigPath(configPath);
  if (!existsSync(path)) {
    throw new Error(`Config not found: ${path}`);
  }
  const config = loadJson(path);
  const section = config.cameraWatch || {};
  // Camera watch list is independent of PPE and Incident lists.
  const trucks = normalizeCameraTruckEntries(section.trucks || []);

  return {
    path,
    config,
    trucks,
    truckIds: trucks.map((entry) => entry.id),
    pollIntervalMs: section.pollIntervalMs ?? 60000,
  };
}

export function listCameraTrucks(configPath = DEFAULT_CONFIG) {
  return readCameraConfig(configPath).trucks;
}

function saveTruckEntries(current, trucks) {
  const latest = loadJson(current.path);
  latest.cameraWatch = {
    ...(latest.cameraWatch || {}),
    trucks,
  };
  saveJson(current.path, latest);
  current.config = latest;
  current.trucks = trucks;
}

export function addCameraTruck(
  truckNumber,
  { driver = "", comment = "", device = "", mark = "", configPath = DEFAULT_CONFIG } = {}
) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");
  const driverName = String(driver || "").trim();
  const commentText = String(comment || "").trim();
  const deviceNumber = String(device || "").trim();
  const incomingMark = normalizeCameraMark(mark);

  return withConfigLock(configPath, () => {
    const current = readCameraConfig(configPath);
    const existing = current.trucks.find((entry) => entry.id === truck);
    if (existing) {
      let updated = false;
      if (driverName && existing.driver !== driverName) {
        existing.driver = driverName;
        updated = true;
      }
      if (deviceNumber && existing.device !== deviceNumber) {
        existing.device = deviceNumber;
        updated = true;
      }
      if (incomingMark) {
        const nextMark = preferCameraMark(existing.mark, incomingMark);
        if (nextMark !== (existing.mark || "")) {
          existing.mark = nextMark;
          updated = true;
        }
      }
      if (
        commentText &&
        existing.comment !== commentText &&
        (!existing.comment || isAutoCameraComment(existing.comment))
      ) {
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
        device: existing.device || "",
        mark: existing.mark || "",
      };
    }

    const resolvedMark = incomingMark;
    const resolvedComment = commentText || cameraMarkComment(resolvedMark);
    const trucks = [
      ...current.trucks,
      {
        id: truck,
        driver: driverName,
        comment: resolvedComment,
        device: deviceNumber,
        mark: resolvedMark,
      },
    ];
    saveTruckEntries(current, trucks);
    return {
      trucks,
      added: true,
      updated: false,
      truck,
      driver: driverName,
      comment: resolvedComment,
      device: deviceNumber,
      mark: resolvedMark,
    };
  });
}

export function removeCameraTruck(truckNumber, configPath = DEFAULT_CONFIG) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  return withConfigLock(configPath, () => {
    const current = readCameraConfig(configPath);
    const trucks = current.trucks.filter((entry) => entry.id !== truck);
    if (trucks.length === current.trucks.length) {
      return { trucks: current.trucks, removed: false, truck };
    }
    saveTruckEntries(current, trucks);
    return { trucks, removed: true, truck };
  });
}

export function setCameraTruckDriver(
  truckNumber,
  driver,
  configPath = DEFAULT_CONFIG
) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  return withConfigLock(configPath, () => {
    const current = readCameraConfig(configPath);
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

export function setCameraTruckComment(
  truckNumber,
  comment,
  configPath = DEFAULT_CONFIG
) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  return withConfigLock(configPath, () => {
    const current = readCameraConfig(configPath);
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

export function setCameraTruckDevice(
  truckNumber,
  device,
  configPath = DEFAULT_CONFIG
) {
  const truck = normalizeTruckId(truckNumber);
  if (!truck) throw new Error("Truck number is required");

  return withConfigLock(configPath, () => {
    const current = readCameraConfig(configPath);
    const existing = current.trucks.find((entry) => entry.id === truck);
    if (!existing) {
      return { updated: false, truck, device: "", missing: true };
    }
    const deviceNumber = String(device || "").trim();
    if (existing.device === deviceNumber) {
      return { updated: false, truck, device: existing.device, missing: false };
    }
    existing.device = deviceNumber;
    saveTruckEntries(current, current.trucks);
    return { updated: true, truck, device: deviceNumber, missing: false };
  });
}

export function setCameraTrucks(truckNumbers, configPath = DEFAULT_CONFIG) {
  return withConfigLock(configPath, () => {
    const current = readCameraConfig(configPath);
    const previous = new Map(
      current.trucks.map((entry) => [
        entry.id,
        { driver: entry.driver, comment: entry.comment, device: entry.device, mark: entry.mark },
      ])
    );
    const trucks = normalizeCameraTruckEntries(truckNumbers).map((entry) => ({
      id: entry.id,
      driver: entry.driver || previous.get(entry.id)?.driver || "",
      comment: entry.comment || previous.get(entry.id)?.comment || "",
      device: entry.device || previous.get(entry.id)?.device || "",
      mark: entry.mark || previous.get(entry.id)?.mark || "",
    }));
    saveTruckEntries(current, trucks);
    return { trucks };
  });
}
