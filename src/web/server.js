import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { loadEnvFile } from "../loadEnv.js";
import {
  addDepotTruck,
  listDepotTrucks,
  readDepotConfig,
  removeDepotTruck,
  setDepotTruckDriver,
  setDepotTrucks,
} from "./depotConfig.js";
import {
  addIncidentsTruck,
  listIncidentsTrucks,
  readIncidentsConfig,
  removeIncidentsTruck,
  setIncidentsTruckComment,
  setIncidentsTruckDriver,
  setIncidentsTrucks,
} from "./incidentsConfig.js";
import { fetchVehicleDriverName } from "./fetchVehicleDriver.js";
import {
  buildWakeStage2ExportCsv,
  getWakeStage2,
  isWakeStage2Cancelled,
  markWakeStage2Looking,
  setWakeStage2Driver,
  setWakeStage2Error,
  startWakeStage2,
  stopWakeStage2,
} from "./wakeStage2.js";
import {
  getDepotSnapshot,
  getIncidentsSnapshot,
  getCameraSnapshot,
  getTask,
  listTasks,
  readTaskLog,
  startTask,
  stopTask,
} from "./taskManager.js";
import { getJohannesburgCoverageSummary } from "../utils/locationClassifier.js";
import {
  addCameraTruck,
  listCameraTrucks,
  readCameraConfig,
  removeCameraTruck,
  setCameraTruckComment,
  setCameraTruckDevice,
  setCameraTruckDriver,
  setCameraTrucks,
} from "./cameraConfig.js";
import {
  normalizeReason,
  reasonLabel,
  TRACKING_REASON_META,
} from "./trackingReasons.js";
import {
  buildTrackingExportCsv,
  trackingExportFilename,
} from "./trackingExport.js";

loadEnvFile();

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");
const PORT = Number(process.env.DASHBOARD_PORT || 8787);
const HOST = process.env.DASHBOARD_HOST || "0.0.0.0";
const CONFIG_PATH = process.env.CLICKBOT_CONFIG || "config/local.json";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, urlPath) {
  let relative = urlPath === "/" ? "/index.html" : urlPath;
  if (relative === "/depot" || relative === "/depot/") relative = "/tracking-ppe.html";
  if (relative === "/tracking" || relative === "/tracking/") relative = "/tracking-overview.html";
  if (relative === "/tracking/ppe" || relative === "/tracking/ppe/") {
    relative = "/tracking-ppe.html";
  }
  if (relative === "/tracking/incident" || relative === "/tracking/incident/") {
    relative = "/tracking-incident.html";
  }
  if (relative === "/tracking/camera" || relative === "/tracking/camera/") {
    relative = "/tracking-camera.html";
  }
  if (relative === "/wake-trucks" || relative === "/wake-trucks/") relative = "/wake-trucks.html";
  if (
    relative === "/incidents-drivers" ||
    relative === "/incidents-drivers/" ||
    relative === "/incidents" ||
    relative === "/incidents/"
  ) {
    relative = "/tracking-incident.html";
  }
  relative = relative.split("?")[0];
  const filePath = join(publicDir, relative);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const type = MIME[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(readFileSync(filePath));
}

function localAddresses() {
  const nets = networkInterfaces();
  const out = [];
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

function restartDepotIfRunning() {
  const task = getTask("depot-monitor");
  if (!task?.running) {
    return { restarted: false, task };
  }
  stopTask("depot-monitor");
  // Give the child a moment to exit before relaunching with new truck list.
  setTimeout(() => {
    startTask("depot-monitor", { configPath: CONFIG_PATH });
  }, 1200);
  return { restarted: true, task: getTask("depot-monitor") };
}

function restartIncidentsIfRunning() {
  const task = getTask("incidents-monitor");
  if (!task?.running) {
    return { restarted: false, task };
  }
  stopTask("incidents-monitor");
  setTimeout(() => {
    startTask("incidents-monitor", { configPath: CONFIG_PATH });
  }, 1200);
  return { restarted: true, task: getTask("incidents-monitor") };
}

function restartCameraIfRunning() {
  const task = getTask("camera-monitor");
  if (!task?.running) {
    return { restarted: false, task };
  }
  stopTask("camera-monitor");
  setTimeout(() => {
    startTask("camera-monitor", { configPath: CONFIG_PATH });
  }, 1200);
  return { restarted: true, task: getTask("camera-monitor") };
}

const driverLookupQueue = [];
/** Trucks cancelled while a lookup was queued or in flight (e.g. user removed them). */
const cancelledDriverLookups = new Set();
let driverLookupRunning = false;

/** Separate queue so incidents driver lookups don't fight depot lookups. */
const incidentsDriverLookupQueue = [];
const cancelledIncidentsDriverLookups = new Set();
let incidentsDriverLookupRunning = false;

const cameraDriverLookupQueue = [];
const cancelledCameraDriverLookups = new Set();
let cameraDriverLookupRunning = false;

function queueDriverLookup(truckNumber) {
  const truck = String(truckNumber || "").trim().toUpperCase();
  if (!truck) return;
  cancelledDriverLookups.delete(truck);
  if (!driverLookupQueue.includes(truck)) driverLookupQueue.push(truck);
  void processDriverLookupQueue();
}

function cancelDriverLookup(truckNumber) {
  const truck = String(truckNumber || "").trim().toUpperCase();
  if (!truck) return;
  cancelledDriverLookups.add(truck);
  const idx = driverLookupQueue.indexOf(truck);
  if (idx >= 0) driverLookupQueue.splice(idx, 1);
}

function queueIncidentsDriverLookup(truckNumber) {
  const truck = String(truckNumber || "").trim().toUpperCase();
  if (!truck) return;
  cancelledIncidentsDriverLookups.delete(truck);
  if (!incidentsDriverLookupQueue.includes(truck)) {
    incidentsDriverLookupQueue.push(truck);
  }
  void processIncidentsDriverLookupQueue();
}

function cancelIncidentsDriverLookup(truckNumber) {
  const truck = String(truckNumber || "").trim().toUpperCase();
  if (!truck) return;
  cancelledIncidentsDriverLookups.add(truck);
  const idx = incidentsDriverLookupQueue.indexOf(truck);
  if (idx >= 0) incidentsDriverLookupQueue.splice(idx, 1);
}

function queueCameraDriverLookup(truckNumber) {
  const truck = String(truckNumber || "").trim().toUpperCase();
  if (!truck) return;
  cancelledCameraDriverLookups.delete(truck);
  if (!cameraDriverLookupQueue.includes(truck)) {
    cameraDriverLookupQueue.push(truck);
  }
  void processCameraDriverLookupQueue();
}

function cancelCameraDriverLookup(truckNumber) {
  const truck = String(truckNumber || "").trim().toUpperCase();
  if (!truck) return;
  cancelledCameraDriverLookups.add(truck);
  const idx = cameraDriverLookupQueue.indexOf(truck);
  if (idx >= 0) cameraDriverLookupQueue.splice(idx, 1);
}

async function processDriverLookupQueue() {
  if (driverLookupRunning) return;
  driverLookupRunning = true;
  try {
    while (driverLookupQueue.length) {
      const truck = driverLookupQueue.shift();
      if (cancelledDriverLookups.has(truck)) {
        cancelledDriverLookups.delete(truck);
        continue;
      }
      try {
        console.log(`[depot] Looking up driver for ${truck}...`);
        const driver = await fetchVehicleDriverName(truck, CONFIG_PATH);
        if (cancelledDriverLookups.has(truck)) {
          cancelledDriverLookups.delete(truck);
          console.log(`[depot] ${truck} lookup discarded (truck removed)`);
          continue;
        }
        if (driver) {
          // Never re-add a truck the user already removed.
          const result = setDepotTruckDriver(truck, driver, CONFIG_PATH);
          if (result.missing) {
            console.log(`[depot] ${truck} -> ${driver} (skipped, not on list)`);
          } else {
            console.log(`[depot] ${truck} -> ${driver}`);
          }
        } else {
          console.log(`[depot] ${truck} -> (no driver)`);
        }
      } catch (error) {
        console.log(
          `[depot] Driver lookup failed for ${truck}: ${error.message || error}`
        );
      }
    }
  } finally {
    driverLookupRunning = false;
    if (driverLookupQueue.length) void processDriverLookupQueue();
  }
}

async function processIncidentsDriverLookupQueue() {
  if (incidentsDriverLookupRunning) return;
  incidentsDriverLookupRunning = true;
  try {
    while (incidentsDriverLookupQueue.length) {
      const truck = incidentsDriverLookupQueue.shift();
      if (cancelledIncidentsDriverLookups.has(truck)) {
        cancelledIncidentsDriverLookups.delete(truck);
        continue;
      }
      try {
        console.log(`[incidents] Looking up driver for ${truck}...`);
        const driver = await fetchVehicleDriverName(truck, CONFIG_PATH);
        if (cancelledIncidentsDriverLookups.has(truck)) {
          cancelledIncidentsDriverLookups.delete(truck);
          console.log(`[incidents] ${truck} lookup discarded (truck removed)`);
          continue;
        }
        if (driver) {
          const result = setIncidentsTruckDriver(truck, driver, CONFIG_PATH);
          if (result.missing) {
            console.log(`[incidents] ${truck} -> ${driver} (skipped, not on list)`);
          } else {
            console.log(`[incidents] ${truck} -> ${driver}`);
          }
        } else {
          console.log(`[incidents] ${truck} -> (no driver)`);
        }
      } catch (error) {
        console.log(
          `[incidents] Driver lookup failed for ${truck}: ${error.message || error}`
        );
      }
    }
  } finally {
    incidentsDriverLookupRunning = false;
    if (incidentsDriverLookupQueue.length) void processIncidentsDriverLookupQueue();
  }
}

async function processCameraDriverLookupQueue() {
  if (cameraDriverLookupRunning) return;
  cameraDriverLookupRunning = true;
  try {
    while (cameraDriverLookupQueue.length) {
      const truck = cameraDriverLookupQueue.shift();
      if (cancelledCameraDriverLookups.has(truck)) {
        cancelledCameraDriverLookups.delete(truck);
        continue;
      }
      try {
        console.log(`[camera] Looking up driver for ${truck}...`);
        const driver = await fetchVehicleDriverName(truck, CONFIG_PATH);
        if (cancelledCameraDriverLookups.has(truck)) {
          cancelledCameraDriverLookups.delete(truck);
          console.log(`[camera] ${truck} lookup discarded (truck removed)`);
          continue;
        }
        if (driver) {
          const result = setCameraTruckDriver(truck, driver, CONFIG_PATH);
          if (result.missing) {
            console.log(`[camera] ${truck} -> ${driver} (skipped, not on list)`);
          } else {
            console.log(`[camera] ${truck} -> ${driver}`);
          }
        } else {
          console.log(`[camera] ${truck} -> (no driver)`);
        }
      } catch (error) {
        console.log(
          `[camera] Driver lookup failed for ${truck}: ${error.message || error}`
        );
      }
    }
  } finally {
    cameraDriverLookupRunning = false;
    if (cameraDriverLookupQueue.length) void processCameraDriverLookupQueue();
  }
}

const wakeStage2LookupQueue = [];
let wakeStage2LookupRunning = false;

function queueWakeStage2Lookups(trucks) {
  wakeStage2LookupQueue.length = 0;
  for (const truck of trucks) {
    const id = String(truck || "").trim().toUpperCase();
    if (id) wakeStage2LookupQueue.push(id);
  }
  void processWakeStage2LookupQueue();
}

async function processWakeStage2LookupQueue() {
  if (wakeStage2LookupRunning) return;
  wakeStage2LookupRunning = true;
  try {
    while (wakeStage2LookupQueue.length) {
      if (isWakeStage2Cancelled()) {
        wakeStage2LookupQueue.length = 0;
        break;
      }
      const truck = wakeStage2LookupQueue.shift();
      markWakeStage2Looking(truck);
      try {
        console.log(`[wake-stage2] Looking up driver for ${truck}...`);
        const driver = await fetchVehicleDriverName(truck, CONFIG_PATH);
        if (isWakeStage2Cancelled()) break;
        setWakeStage2Driver(truck, driver);
        console.log(`[wake-stage2] ${truck} -> ${driver || "(no driver)"}`);
      } catch (error) {
        if (isWakeStage2Cancelled()) break;
        setWakeStage2Error(truck, error);
        console.log(
          `[wake-stage2] Driver lookup failed for ${truck}: ${error.message || error}`
        );
      }
    }
  } finally {
    wakeStage2LookupRunning = false;
    if (wakeStage2LookupQueue.length && !isWakeStage2Cancelled()) {
      void processWakeStage2LookupQueue();
    }
  }
}

function stage1WokenTrucks() {
  const task = getTask("wake-trucks");
  const status = task?.status || {};
  const fromSummary = status.summary?.clickedVehicles;
  const fromStatus = status.clickedVehicles;
  return [...(fromSummary || fromStatus || [])]
    .map((t) => String(t || "").trim().toUpperCase())
    .filter(Boolean);
}

function csvEscape(value) {
  const text = String(value ?? "")
    .replace(/\r\n/g, " ")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/[",]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildIncidentsExportCsv() {
  return buildTrackingExportCsv("incident", CONFIG_PATH);
}

function sendTrackingExport(res, reason) {
  try {
    const csv = buildTrackingExportCsv(reason, CONFIG_PATH);
    res.writeHead(200, {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="${trackingExportFilename(reason)}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
    });
    res.end(csv);
  } catch (error) {
    sendJson(res, 400, { error: error.message || String(error) });
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      now: new Date().toISOString(),
      host: HOST,
      port: PORT,
      addresses: localAddresses(),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/tasks") {
    return sendJson(res, 200, { tasks: listTasks() });
  }

  if (req.method === "GET" && url.pathname === "/api/depot") {
    const config = readDepotConfig(CONFIG_PATH);
    return sendJson(res, 200, {
      depot: getDepotSnapshot(),
      trucks: config.trucks,
      targetArea: config.targetArea,
      targetAreas: config.targetAreas,
      pollIntervalMs: config.pollIntervalMs,
      task: getTask("depot-monitor"),
      reason: "ppe",
      reasonLabel: reasonLabel("ppe"),
    });
  }

  if (url.pathname === "/api/depot/trucks") {
    if (req.method === "GET") {
      return sendJson(res, 200, { trucks: listDepotTrucks(CONFIG_PATH) });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const truck = body.truck || body.truckNumber;
      const providedDriver = String(body.driver || "").trim();

      // Save immediately so the UI does not hang on slow Webfleet lookup (~60-90s).
      const result = addDepotTruck(truck, {
        driver: providedDriver,
        configPath: CONFIG_PATH,
      });
      const restart =
        body.restart === false ? { restarted: false } : restartDepotIfRunning();

      const shouldLookup =
        !providedDriver && !body.skipLookup && (result.added || !result.driver);
      if (shouldLookup) {
        queueDriverLookup(result.truck || truck);
      }

      return sendJson(res, 200, {
        ...result,
        lookupPending: shouldLookup,
        lookupError: null,
        ...restart,
      });
    }

    if (req.method === "PUT") {
      const body = await readBody(req);
      const result = setDepotTrucks(body.trucks || [], CONFIG_PATH);
      const restart = body.restart === false ? { restarted: false } : restartDepotIfRunning();
      return sendJson(res, 200, { ...result, ...restart });
    }
  }

  const truckMatch = url.pathname.match(/^\/api\/depot\/trucks\/([^/]+)$/);
  if (truckMatch && req.method === "DELETE") {
    const truck = decodeURIComponent(truckMatch[1]);
    const body = await readBody(req).catch(() => ({}));
    cancelDriverLookup(truck);
    const result = removeDepotTruck(truck, CONFIG_PATH);
    const restart = body.restart === false ? { restarted: false } : restartDepotIfRunning();
    return sendJson(res, 200, { ...result, ...restart });
  }

  if (req.method === "GET" && url.pathname === "/api/incidents") {
    const config = readIncidentsConfig(CONFIG_PATH);
    return sendJson(res, 200, {
      incidents: getIncidentsSnapshot(),
      trucks: config.trucks,
      pollIntervalMs: config.pollIntervalMs,
      johannesburg: getJohannesburgCoverageSummary(),
      task: getTask("incidents-monitor"),
      reason: "incident",
      reasonLabel: reasonLabel("incident"),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/wake-trucks") {
    return sendJson(res, 200, {
      task: getTask("wake-trucks"),
      stage2: getWakeStage2(),
      stage1Trucks: stage1WokenTrucks(),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/wake-trucks/stage2/start") {
    const trucks = stage1WokenTrucks();
    try {
      const stage2 = startWakeStage2(trucks);
      queueWakeStage2Lookups(stage2.trucks.map((r) => r.truck));
      return sendJson(res, 200, { stage2 });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/wake-trucks/stage2/stop") {
    wakeStage2LookupQueue.length = 0;
    return sendJson(res, 200, { stage2: stopWakeStage2() });
  }

  if (req.method === "GET" && url.pathname === "/api/wake-trucks/stage2/export") {
    const csv = buildWakeStage2ExportCsv();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="wake-trucks-drivers-${stamp}.csv"`,
      "Cache-Control": "no-store",
    });
    res.end(csv);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/incidents/export") {
    return sendTrackingExport(res, "incident");
  }

  if (req.method === "GET" && url.pathname === "/api/depot/export") {
    return sendTrackingExport(res, "ppe");
  }

  if (req.method === "GET" && url.pathname === "/api/tracking/export") {
    const reason = url.searchParams.get("reason") || "all";
    return sendTrackingExport(res, reason);
  }

  if (url.pathname === "/api/incidents/trucks") {
    if (req.method === "GET") {
      return sendJson(res, 200, { trucks: listIncidentsTrucks(CONFIG_PATH) });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const truck = body.truck || body.truckNumber;
      const providedDriver = String(body.driver || "").trim();
      const providedComment = String(body.comment || "").trim();

      const result = addIncidentsTruck(truck, {
        driver: providedDriver,
        comment: providedComment,
        configPath: CONFIG_PATH,
      });
      const restart =
        body.restart === false ? { restarted: false } : restartIncidentsIfRunning();

      const shouldLookup =
        !providedDriver && !body.skipLookup && (result.added || !result.driver);
      if (shouldLookup) {
        queueIncidentsDriverLookup(result.truck || truck);
      }

      return sendJson(res, 200, {
        ...result,
        lookupPending: shouldLookup,
        lookupError: null,
        ...restart,
      });
    }

    if (req.method === "PUT") {
      const body = await readBody(req);
      const result = setIncidentsTrucks(body.trucks || [], CONFIG_PATH);
      const restart =
        body.restart === false ? { restarted: false } : restartIncidentsIfRunning();
      return sendJson(res, 200, { ...result, ...restart });
    }
  }

  const incidentsTruckMatch = url.pathname.match(
    /^\/api\/incidents\/trucks\/([^/]+)(?:\/(comment))?$/
  );
  if (incidentsTruckMatch) {
    const truck = decodeURIComponent(incidentsTruckMatch[1]);
    const sub = incidentsTruckMatch[2] || null;

    if (req.method === "DELETE") {
      const body = await readBody(req).catch(() => ({}));
      cancelIncidentsDriverLookup(truck);
      const result = removeIncidentsTruck(truck, CONFIG_PATH);
      const restart =
        body.restart === false ? { restarted: false } : restartIncidentsIfRunning();
      return sendJson(res, 200, { ...result, ...restart });
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      const body = await readBody(req);
      if (sub === "comment" || body.comment != null) {
        const result = setIncidentsTruckComment(
          truck,
          body.comment ?? "",
          CONFIG_PATH
        );
        return sendJson(res, 200, result);
      }
      if (body.driver != null) {
        const result = setIncidentsTruckDriver(truck, body.driver, CONFIG_PATH);
        return sendJson(res, 200, result);
      }
      return sendJson(res, 400, { error: "Provide comment or driver to update" });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/camera") {
    const config = readCameraConfig(CONFIG_PATH);
    return sendJson(res, 200, {
      camera: getCameraSnapshot(),
      trucks: config.trucks,
      pollIntervalMs: config.pollIntervalMs,
      johannesburg: getJohannesburgCoverageSummary(),
      task: getTask("camera-monitor"),
      reason: "camera",
      reasonLabel: reasonLabel("camera"),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/camera/export") {
    return sendTrackingExport(res, "camera");
  }

  if (url.pathname === "/api/camera/trucks") {
    if (req.method === "GET") {
      return sendJson(res, 200, { trucks: listCameraTrucks(CONFIG_PATH) });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const truck = body.truck || body.truckNumber;
      const providedDriver = String(body.driver || "").trim();
      const providedComment = String(body.comment || "").trim();
      const providedDevice = String(body.device || body.deviceNumber || "").trim();

      const result = addCameraTruck(truck, {
        driver: providedDriver,
        comment: providedComment,
        device: providedDevice,
        configPath: CONFIG_PATH,
      });
      const restart =
        body.restart === false ? { restarted: false } : restartCameraIfRunning();

      const shouldLookup =
        !providedDriver && !body.skipLookup && (result.added || !result.driver);
      if (shouldLookup) {
        queueCameraDriverLookup(result.truck || truck);
      }

      return sendJson(res, 200, {
        ...result,
        lookupPending: shouldLookup,
        lookupError: null,
        ...restart,
      });
    }

    if (req.method === "PUT") {
      const body = await readBody(req);
      const result = setCameraTrucks(body.trucks || [], CONFIG_PATH);
      const restart =
        body.restart === false ? { restarted: false } : restartCameraIfRunning();
      return sendJson(res, 200, { ...result, ...restart });
    }
  }

  const cameraTruckMatch = url.pathname.match(
    /^\/api\/camera\/trucks\/([^/]+)(?:\/(comment|device))?$/
  );
  if (cameraTruckMatch) {
    const truck = decodeURIComponent(cameraTruckMatch[1]);
    const sub = cameraTruckMatch[2] || null;

    if (req.method === "DELETE") {
      const body = await readBody(req).catch(() => ({}));
      cancelCameraDriverLookup(truck);
      const result = removeCameraTruck(truck, CONFIG_PATH);
      const restart =
        body.restart === false ? { restarted: false } : restartCameraIfRunning();
      return sendJson(res, 200, { ...result, ...restart });
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      const body = await readBody(req);
      if (sub === "comment" || body.comment != null) {
        const result = setCameraTruckComment(truck, body.comment ?? "", CONFIG_PATH);
        return sendJson(res, 200, result);
      }
      if (sub === "device" || body.device != null || body.deviceNumber != null) {
        const result = setCameraTruckDevice(
          truck,
          body.device ?? body.deviceNumber ?? "",
          CONFIG_PATH
        );
        return sendJson(res, 200, result);
      }
      if (body.driver != null) {
        const result = setCameraTruckDriver(truck, body.driver, CONFIG_PATH);
        return sendJson(res, 200, result);
      }
      return sendJson(res, 400, { error: "Provide comment, device, or driver to update" });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/tracking") {
    const depot = readDepotConfig(CONFIG_PATH);
    const incidents = readIncidentsConfig(CONFIG_PATH);
    const camera = readCameraConfig(CONFIG_PATH);
    const depotSnap = getDepotSnapshot() || {};
    const incidentSnap = getIncidentsSnapshot() || {};
    const cameraSnap = getCameraSnapshot() || {};

    const trucks = [
      ...depot.trucks.map((t) => ({
        ...t,
        comment: t.comment || "",
        reason: "ppe",
        reasonLabel: reasonLabel("ppe"),
      })),
      ...incidents.trucks.map((t) => ({
        ...t,
        reason: "incident",
        reasonLabel: reasonLabel("incident"),
      })),
      ...camera.trucks.map((t) => ({
        ...t,
        reason: "camera",
        reasonLabel: reasonLabel("camera"),
      })),
    ].sort((a, b) => a.id.localeCompare(b.id));

    const cfgByReason = {
      ppe: new Map(depot.trucks.map((t) => [String(t.id).toUpperCase(), t])),
      incident: new Map(
        incidents.trucks.map((t) => [String(t.id).toUpperCase(), t])
      ),
      camera: new Map(camera.trucks.map((t) => [String(t.id).toUpperCase(), t])),
    };

    const liveFrom = (snap, reason) =>
      (snap.trucks || []).map((row) => {
        const cfg =
          cfgByReason[reason]?.get(String(row.truckNumber || "").toUpperCase()) ||
          {};
        return {
          ...row,
          reason,
          reasonLabel: reasonLabel(reason),
          driver: cfg.driver || row.driver || "",
          comment: cfg.comment || row.comment || "",
          inDepot:
            row.inDepot != null ? Boolean(row.inDepot) : Boolean(row.inTargetArea),
          inJohannesburg: Boolean(row.inJohannesburg),
          zone:
            row.zone ||
            (row.inTargetArea || row.inDepot
              ? "depot"
              : row.inJohannesburg
                ? "johannesburg"
                : "other"),
        };
      });

    const liveRows = [
      ...liveFrom(depotSnap, "ppe"),
      ...liveFrom(incidentSnap, "incident"),
      ...liveFrom(cameraSnap, "camera"),
    ];

    const inDepot = liveRows.filter((r) => r.inDepot || r.zone === "depot");
    const inJohannesburg = liveRows.filter(
      (r) => r.inJohannesburg || r.zone === "johannesburg"
    );

    return sendJson(res, 200, {
      reasons: TRACKING_REASON_META,
      trucks,
      live: {
        trucks: liveRows,
        inDepot,
        inJohannesburg,
        inDepotCount: inDepot.length,
        inJohannesburgCount: inJohannesburg.length,
      },
      tasks: {
        ppe: getTask("depot-monitor"),
        incident: getTask("incidents-monitor"),
        camera: getTask("camera-monitor"),
      },
      counts: {
        ppe: depot.trucks.length,
        incident: incidents.trucks.length,
        camera: camera.trucks.length,
        total: trucks.length,
      },
      johannesburg: getJohannesburgCoverageSummary(),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/tracking/trucks") {
    const body = await readBody(req);
    const reason = normalizeReason(body.reason);
    if (!reason) {
      return sendJson(res, 400, {
        error: "reason is required: ppe | incident | camera",
      });
    }
    const truck = body.truck || body.truckNumber;
    const providedDriver = String(body.driver || "").trim();
    const providedComment = String(body.comment || "").trim();

    if (reason === "ppe") {
      const result = addDepotTruck(truck, {
        driver: providedDriver,
        configPath: CONFIG_PATH,
      });
      const restart =
        body.restart === false ? { restarted: false } : restartDepotIfRunning();
      const shouldLookup =
        !providedDriver && !body.skipLookup && (result.added || !result.driver);
      if (shouldLookup) queueDriverLookup(result.truck || truck);
      return sendJson(res, 200, {
        ...result,
        reason,
        reasonLabel: reasonLabel(reason),
        lookupPending: shouldLookup,
        ...restart,
      });
    }

    if (reason === "incident") {
      const result = addIncidentsTruck(truck, {
        driver: providedDriver,
        comment: providedComment,
        configPath: CONFIG_PATH,
      });
      const restart =
        body.restart === false ? { restarted: false } : restartIncidentsIfRunning();
      const shouldLookup =
        !providedDriver && !body.skipLookup && (result.added || !result.driver);
      if (shouldLookup) queueIncidentsDriverLookup(result.truck || truck);
      return sendJson(res, 200, {
        ...result,
        reason,
        reasonLabel: reasonLabel(reason),
        lookupPending: shouldLookup,
        ...restart,
      });
    }

    const result = addCameraTruck(truck, {
      driver: providedDriver,
      comment: providedComment,
      device: String(body.device || body.deviceNumber || "").trim(),
      configPath: CONFIG_PATH,
    });
    const restart =
      body.restart === false ? { restarted: false } : restartCameraIfRunning();
    const shouldLookup =
      !providedDriver && !body.skipLookup && (result.added || !result.driver);
    if (shouldLookup) queueCameraDriverLookup(result.truck || truck);
    return sendJson(res, 200, {
      ...result,
      reason,
      reasonLabel: reasonLabel(reason),
      lookupPending: shouldLookup,
      ...restart,
    });
  }

  const trackingTruckMatch = url.pathname.match(/^\/api\/tracking\/trucks\/([^/]+)$/);
  if (trackingTruckMatch && req.method === "DELETE") {
    const truck = decodeURIComponent(trackingTruckMatch[1]);
    const body = await readBody(req).catch(() => ({}));
    const reason = normalizeReason(body.reason || url.searchParams.get("reason"));
    if (!reason) {
      return sendJson(res, 400, {
        error: "reason is required: ppe | incident | camera",
      });
    }

    if (reason === "ppe") {
      cancelDriverLookup(truck);
      const result = removeDepotTruck(truck, CONFIG_PATH);
      const restart =
        body.restart === false ? { restarted: false } : restartDepotIfRunning();
      return sendJson(res, 200, { ...result, reason, reasonLabel: reasonLabel(reason), ...restart });
    }

    if (reason === "incident") {
      cancelIncidentsDriverLookup(truck);
      const result = removeIncidentsTruck(truck, CONFIG_PATH);
      const restart =
        body.restart === false ? { restarted: false } : restartIncidentsIfRunning();
      return sendJson(res, 200, { ...result, reason, reasonLabel: reasonLabel(reason), ...restart });
    }

    cancelCameraDriverLookup(truck);
    const result = removeCameraTruck(truck, CONFIG_PATH);
    const restart =
      body.restart === false ? { restarted: false } : restartCameraIfRunning();
    return sendJson(res, 200, { ...result, reason, reasonLabel: reasonLabel(reason), ...restart });
  }

  if (req.method === "POST" && url.pathname === "/api/tracking/start-all") {
    const results = {};
    for (const taskId of ["depot-monitor", "incidents-monitor", "camera-monitor"]) {
      try {
        results[taskId] = startTask(taskId, { configPath: CONFIG_PATH });
      } catch (error) {
        results[taskId] = { error: error.message || String(error) };
      }
    }
    return sendJson(res, 200, { results });
  }

  if (req.method === "POST" && url.pathname === "/api/tracking/stop-all") {
    const results = {};
    for (const taskId of ["depot-monitor", "incidents-monitor", "camera-monitor"]) {
      results[taskId] = stopTask(taskId);
    }
    return sendJson(res, 200, { results });
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(start|stop|logs))?$/);
  if (taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    const action = taskMatch[2] || null;

    if (req.method === "GET" && !action) {
      const task = getTask(taskId);
      if (!task) return sendJson(res, 404, { error: "Task not found" });
      return sendJson(res, 200, { task });
    }

    if (req.method === "GET" && action === "logs") {
      const tail = Number(url.searchParams.get("tail") || 120);
      return sendJson(res, 200, { lines: readTaskLog(taskId, { tail }) });
    }

    if (req.method === "POST" && action === "start") {
      const body = await readBody(req).catch(() => ({}));
      const task = startTask(taskId, {
        configPath: body.configPath || CONFIG_PATH,
      });
      return sendJson(res, 200, { task });
    }

    if (req.method === "POST" && action === "stop") {
      const task = stopTask(taskId);
      return sendJson(res, 200, { task });
    }
  }

  return sendJson(res, 404, { error: "Unknown API route" });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  const addresses = localAddresses();
  console.log(`clickbot dashboard listening on http://${HOST}:${PORT}`);
  if (addresses.length) {
    for (const ip of addresses) {
      console.log(`  → http://${ip}:${PORT}`);
    }
  } else {
    console.log(`  → http://127.0.0.1:${PORT}`);
  }
});
