/**
 * Spot-check Webfleet Drivers list → driver No. extraction.
 * Usage: node scripts/verifyDriverNames.js [truck...]
 */
import { loadEnvFile } from "../src/loadEnv.js";
import { chromium } from "playwright";
import { maybeLogin } from "../src/login.js";
import {
  ensureWebfleetDrivers,
  lookupDriverInWebfleet,
} from "../src/apps/webfleet.js";
import { loadConfig } from "../src/config.js";
import { resolveDriverName } from "../src/utils/driverName.js";

loadEnvFile();

const trucks = process.argv.slice(2);
const defaults = ["H2021", "H2310", "NH2371", "NH2402", "NH2408"];
const targets = trucks.length ? trucks : defaults;

const config = loadConfig({
  configPath: process.env.CLICKBOT_CONFIG || "config/local.json",
});

const browser = await chromium.launch({
  headless: Boolean(config.headless),
  slowMo: config.slowMoMs ?? 0,
});
const context = await browser.newContext();
const webfleet = await context.newPage();

try {
  await webfleet.goto(config.apps.fleet.url, { waitUntil: "domcontentloaded" });
  await maybeLogin(webfleet, config.apps.fleet, "fleet");
  await ensureWebfleetDrivers(webfleet, config.apps.fleet);

  console.log("Verifying Webfleet Drivers → No. (driver id for Lytx):\n");
  let failures = 0;
  for (const truck of targets) {
    const raw = await lookupDriverInWebfleet(
      webfleet,
      config.apps.fleet.selectors,
      truck
    );
    const resolved = resolveDriverName(raw, config);
    const looksLikeId = /^[A-Za-z]{0,4}\d{2,}$/i.test(resolved.name);

    console.log(`Truck ${truck}`);
    console.log(`  raw No.:     ${JSON.stringify(raw)}`);
    console.log(`  assign as:   ${JSON.stringify(resolved.name)}`);
    if (!raw) {
      failures += 1;
      console.log("  check:       FAIL — no driver No. found");
    } else if (!looksLikeId && !resolved.usedFallback) {
      console.log("  check:       WARN — value does not look like a driver No.");
    } else {
      console.log("  check:       OK");
    }
    console.log("");
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
