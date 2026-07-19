/**
 * Spot-check Webfleet DRIVER → Name extraction (name only, no phones).
 * Usage: node scripts/verifyDriverNames.js [truck...]
 */
import { loadEnvFile } from "../src/loadEnv.js";
import { chromium } from "playwright";
import { maybeLogin } from "../src/login.js";
import { ensureWebfleetMap, lookupDriverInWebfleet } from "../src/apps/webfleet.js";
import { loadConfig } from "../src/config.js";
import { cleanDriverName, resolveDriverName } from "../src/utils/driverName.js";

loadEnvFile();

const trucks = process.argv.slice(2);
const defaults = ["TH2239", "NH2003", "H2325", "H2279"];
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
  if (config.apps.fleet.workUrl) {
    await webfleet.goto(config.apps.fleet.workUrl, {
      waitUntil: "domcontentloaded",
    });
  }
  await ensureWebfleetMap(webfleet, config.apps.fleet);

  console.log("Verifying Webfleet DRIVER names (must be name-only, no contact numbers):\n");
  let failures = 0;
  for (const truck of targets) {
    const raw = await lookupDriverInWebfleet(webfleet, config.apps.fleet.selectors, truck);
    const cleaned = cleanDriverName(raw);
    const resolved = resolveDriverName(raw, config);
    const hasPhoneDigits = /\+?\d[\d\s\-()]{6,}\d/.test(raw || "");
    // Allow short digits in names only if not phone-length; reject 6+ consecutive digit runs.
    const cleanedHasPhone = /\d{6,}/.test(String(cleaned).replace(/[\s\-()]/g, ""));

    console.log(`Truck ${truck}`);
    console.log(`  raw from DRIVER→Name: ${JSON.stringify(raw)}`);
    console.log(`  cleaned:              ${JSON.stringify(cleaned)}`);
    console.log(`  assigned as:          ${JSON.stringify(resolved.name)}`);
    if (cleanedHasPhone) {
      failures += 1;
      console.log("  phone check:          FAIL — contact number still in cleaned name");
    } else {
      console.log(
        `  phone check:          OK — no contact number in cleaned name${
          hasPhoneDigits ? " (raw had phone-like digits; stripped)" : ""
        }`
      );
    }
    console.log("");
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
