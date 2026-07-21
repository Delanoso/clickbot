import { readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "../src/loadEnv.js";
import { loadConfig } from "../src/config.js";
import { openWebfleetOnly } from "../src/browser.js";
import { lookupVehicleDriverInWebfleet } from "../src/apps/webfleet.js";
import { cleanDriverName } from "../src/utils/driverName.js";
import {
  normalizeTruckEntries,
  setDepotTruckDriver,
} from "../src/web/depotConfig.js";

loadEnvFile();

const configPath = process.argv[2] || "config/local.json";
const force = process.argv.includes("--force");
const maxRetries = Number(
  process.argv.find((a) => a.startsWith("--retries="))?.split("=")[1] || 3
);

const config = loadConfig({ configPath, relaxValidation: true });
config.headless = true;

function readTrucks() {
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  return normalizeTruckEntries(raw.depotMonitor?.trucks || []);
}

let trucks = readTrucks();
if (!trucks.length) {
  console.log("No trucks to backfill.");
  process.exit(0);
}

/** Successfully looked up (including "no driver in Webfleet"). */
const done = new Set(
  force ? [] : trucks.filter((truck) => truck.driver).map((truck) => truck.id)
);
const failures = new Map();

function pending() {
  // Re-read so UI removals are respected — never rewrite deleted trucks.
  trucks = readTrucks();
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
    // Only updates an existing truck — will no-op if the user removed it.
    const result = setDepotTruckDriver(truck.id, cleaned || truck.driver || "", configPath);
    done.add(truck.id);
    failures.delete(truck.id);
    if (result.missing) {
      console.log("(skipped — no longer on watch list)");
    } else {
      console.log(cleaned || truck.driver || "(no driver)");
    }
  } catch (error) {
    console.log(`ERROR: ${error.message || error}`);
    failures.set(truck.id, attempt);
    if (attempt >= maxRetries) {
      console.log(`  giving up on ${truck.id} after ${attempt} failures`);
      done.add(truck.id);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // Let the OS reclaim Chromium memory before the next launch on the 2GB VPS.
  await new Promise((r) => setTimeout(r, 1500));
}

trucks = readTrucks();
const withDrivers = trucks.filter((truck) => truck.driver).length;
console.log(`\nDONE: ${withDrivers}/${trucks.length} trucks have drivers.`);
