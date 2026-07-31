import fs from "node:fs";
import { chromium } from "playwright";
import { loadEnvFile } from "../src/loadEnv.js";
import { loadConfig } from "../src/config.js";
import { maybeLogin } from "../src/login.js";
import { ensureWebfleetDrivers } from "../src/apps/webfleet.js";
import { locate } from "../src/locate.js";

loadEnvFile();
const config = loadConfig({ configPath: "config/local.json", relaxValidation: true });

const drivers = [
  "D3046",
  "D3551",
  "D3555",
  "D3270",
  "D3626",
  "D3888",
  "D3310",
  "D3954",
  "D3823",
  "D3652",
  "D3776",
  "D3799",
  "D3303",
  "D3285",
  "D3127",
  "DT3656",
  "D3582",
];

async function resolveDriversSearchInput(page, selectors) {
  if (selectors?.searchInput) {
    const locator = locate(page, selectors.searchInput);
    try {
      await locator.waitFor({ state: "visible", timeout: 5000 });
      return locator;
    } catch {
      // continue
    }
  }

  const candidates = page.locator(
    'input.t3sel-filterable-list-filter, input[type="search"], input[placeholder="Search"]'
  );
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return candidates.last();
}

async function lookupVehicleForDriver(page, search, driverNo) {
  await search.fill("", { force: true });
  await search.fill(driverNo, { force: true });
  await search.press("Enter");
  await page.waitForTimeout(1200);

  const result = await page.evaluate((needle) => {
    const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const table = document.querySelector("table");
    const headers = table
      ? [...table.querySelectorAll("thead th")].map((h) => normalize(h.innerText))
      : [...document.querySelectorAll('[role="columnheader"]')].map((h) =>
          normalize(h.innerText)
        );

    let noIdx = headers.findIndex((h) => /^No\.?$/i.test(h));
    let vehicleIdx = headers.findIndex((h) => /^Vehicle$/i.test(h));
    if (noIdx < 0) noIdx = 2;
    if (vehicleIdx < 0) vehicleIdx = 3;

    const rows = table
      ? [...table.querySelectorAll("tbody tr")]
      : [...document.querySelectorAll('[role="row"]')].filter(
          (r) => r.querySelectorAll('[role="cell"]').length > 2
        );

    const wanted = needle.toUpperCase();
    for (const tr of rows) {
      const cells = [...tr.querySelectorAll(table ? "td" : '[role="cell"]')].map((c) =>
        normalize(c.innerText)
      );
      const no = (cells[noIdx] || "").split(/\s+/)[0].toUpperCase();
      if (no !== wanted) continue;

      const vehicleRaw = cells[vehicleIdx] || "";
      if (!vehicleRaw || /^—+$/.test(vehicleRaw) || /^(n\/a|na|none|-|--)$/i.test(vehicleRaw)) {
        return { found: true, truck: "", vehicleRaw };
      }
      const truck = vehicleRaw.split(/\s*[–—-]\s*/)[0].trim();
      return { found: true, truck, vehicleRaw };
    }
    return { found: false, truck: "", vehicleRaw: "" };
  }, driverNo);

  return result;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(config.apps.fleet.url, { waitUntil: "domcontentloaded", timeout: 60000 });
await maybeLogin(page, config.apps.fleet, "fleet");
await page.goto("https://live-wf.webfleet.com/web/drivers/list", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await ensureWebfleetDrivers(page, {
  ...config.apps.fleet,
  workUrl: "https://live-wf.webfleet.com/web/drivers/list",
});

const search = await resolveDriversSearchInput(page, config.apps.fleet.selectors || {});
await search.waitFor({ state: "visible", timeout: 30000 });

const found = [];
const missing = [];
const noVehicle = [];

for (const driverNo of drivers) {
  const result = await lookupVehicleForDriver(page, search, driverNo);
  if (!result.found) {
    missing.push(driverNo);
    console.log(`${driverNo} -> NOT FOUND`);
    continue;
  }
  if (!result.truck) {
    noVehicle.push(driverNo);
    console.log(`${driverNo} -> found, but no vehicle`);
    continue;
  }
  found.push({ driverNo, truck: result.truck, vehicleRaw: result.vehicleRaw });
  console.log(`${driverNo} -> ${result.truck}`);
}

const report = { found, missing, noVehicle };
fs.writeFileSync("/tmp/driver-to-truck-lookup.json", JSON.stringify(report, null, 2));
console.log("\nSUMMARY");
console.log(JSON.stringify(report, null, 2));
await browser.close();
