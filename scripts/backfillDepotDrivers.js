import { readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "../src/loadEnv.js";
import { loadConfig } from "../src/config.js";
import { openWebfleetOnly } from "../src/browser.js";
import { lookupVehicleDriverInWebfleet } from "../src/apps/webfleet.js";
import { cleanDriverName } from "../src/utils/driverName.js";
import { normalizeTruckEntries } from "../src/web/depotConfig.js";

loadEnvFile();

const configPath = process.argv[2] || "config/local.json";
const force = process.argv.includes("--force");
const maxRetries = Number(
  process.argv.find((a) => a.startsWith("--retries="))?.split("=")[1] || 3
);

const config = loadConfig({ configPath, relaxValidation: true });
config.headless = true;

const raw = JSON.parse(readFileSync(configPath, "utf8"));
const trucks = normalizeTruckEntries(raw.depotMonitor?.trucks || []);
if (!trucks.length) {
  console.log("No trucks to backfill.");
  process.exit(0);
}

const updated = new Map(trucks.map((truck) => [truck.id, { ...truck }]));
/** Successfully looked up (including "no driver in Webfleet"). */
const done = new Set(
  force ? [] : trucks.filter((truck) => truck.driver).map((truck) => truck.id)
);
const failures = new Map();

function saveProgress() {
  raw.depotMonitor = raw.depotMonitor || {};
  raw.depotMonitor.trucks = trucks.map((truck) => updated.get(truck.id) || truck);
  writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);
}

function pending() {
  return trucks.filter((truck) => !done.has(truck.id));
}

function normalizeDriver(rawDriver) {
  const driver = cleanDriverName(rawDriver);
  if (!driver) return "";
  if (/^(no driver|n\/a|na|none|unknown|-|--)$/i.test(driver)) return "";
  return driver;
}

console.log(
  `Backfilling drivers for ${pending().length}/${trucks.length} trucks` +
    ` (1 browser/truck, maxRetries=${maxRetries})`
);

while (pending().length) {
  const truck = pending()[0];
  const attempt = (failures.get(truck.id) || 0) + 1;
  process.stdout.write(
    `[${done.size + 1}/${trucks.length}] ${truck.id} (try ${attempt}) ... `
  );

  let browser;
  try {
    const session = await openWebfleetOnly(config, { lowMemory: true });
    browser = session.browser;
    const { page } = session;

    const rawDriver = await lookupVehicleDriverInWebfleet(
      page,
      config.apps.fleet?.selectors || {},
      truck.id
    );
    const cleaned = normalizeDriver(rawDriver);
    const prev = updated.get(truck.id) || { id: truck.id, driver: "" };
    updated.set(truck.id, {
      id: truck.id,
      driver: cleaned || prev.driver || "",
    });
    done.add(truck.id);
    failures.delete(truck.id);
    saveProgress();
    console.log(cleaned || prev.driver || "(no driver)");
  } catch (error) {
    console.log(`ERROR: ${error.message || error}`);
    failures.set(truck.id, attempt);
    if (attempt >= maxRetries) {
      console.log(`  giving up on ${truck.id} after ${attempt} failures`);
      done.add(truck.id);
      saveProgress();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // Let the OS reclaim Chromium memory before the next launch on the 2GB VPS.
  await new Promise((r) => setTimeout(r, 1500));
}

saveProgress();
const withDrivers = [...updated.values()].filter((truck) => truck.driver).length;
console.log(`\nDONE: ${withDrivers}/${updated.size} trucks have drivers.`);
