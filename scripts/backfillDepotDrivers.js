import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "../src/loadEnv.js";
import { loadConfig } from "../src/config.js";
import { openWebfleetOnly } from "../src/browser.js";
import { lookupVehicleDriverInWebfleet } from "../src/apps/webfleet.js";
import { cleanDriverName } from "../src/utils/driverName.js";
import { normalizeTruckEntries } from "../src/web/depotConfig.js";

loadEnvFile();

const configPath = resolve(process.argv[2] || "config/local.json");
const force = process.argv.includes("--force");

const config = loadConfig({ configPath, relaxValidation: true });
const raw = JSON.parse(readFileSync(configPath, "utf8"));
const trucks = normalizeTruckEntries(raw.depotMonitor?.trucks || []);
if (!trucks.length) {
  console.log("No trucks to backfill.");
  process.exit(0);
}

const targets = force ? trucks : trucks.filter((truck) => !truck.driver);
console.log(
  `Backfilling ${targets.length} of ${trucks.length} truck(s)` +
    (force ? " (--force)" : " (missing drivers only)")
);

const { browser, page } = await openWebfleetOnly(config);
const updated = new Map(trucks.map((truck) => [truck.id, { ...truck }]));

try {
  for (const truck of targets) {
    process.stdout.write(`${truck.id} ... `);
    try {
      const rawDriver = await lookupVehicleDriverInWebfleet(
        page,
        config.apps.fleet?.selectors || {},
        truck.id
      );
      const driver = cleanDriverName(rawDriver);
      const cleaned =
        driver && !/^(no driver|n\/a|na|none|unknown|-|--)$/i.test(driver)
          ? driver
          : "";
      updated.set(truck.id, { id: truck.id, driver: cleaned });
      console.log(cleaned || "(no driver)");
    } catch (error) {
      console.log(`ERROR: ${error.message || error}`);
    }
  }
} finally {
  await browser.close();
}

raw.depotMonitor = raw.depotMonitor || {};
raw.depotMonitor.trucks = [...updated.values()];
writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`);

const withDrivers = raw.depotMonitor.trucks.filter((truck) => truck.driver).length;
console.log(
  `\nSaved ${configPath}: ${withDrivers}/${raw.depotMonitor.trucks.length} trucks have drivers.`
);
