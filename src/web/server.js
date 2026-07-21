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
import { fetchVehicleDriverName } from "./fetchVehicleDriver.js";
import {
  getDepotSnapshot,
  getTask,
  listTasks,
  readTaskLog,
  startTask,
  stopTask,
} from "./taskManager.js";

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
  if (relative === "/depot" || relative === "/depot/") relative = "/depot.html";
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

const driverLookupQueue = [];
/** Trucks cancelled while a lookup was queued or in flight (e.g. user removed them). */
const cancelledDriverLookups = new Set();
let driverLookupRunning = false;

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
