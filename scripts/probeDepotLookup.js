import { chromium } from "playwright";
import fs from "node:fs";
import { loadEnvFile } from "../src/loadEnv.js";
import { loadConfig } from "../src/config.js";
import { maybeLogin } from "../src/login.js";

loadEnvFile();
const config = loadConfig({ configPath: "config/local.json", relaxValidation: true });
const truck = process.argv[2] || "R2609MH";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(config.apps.fleet.url, { waitUntil: "domcontentloaded", timeout: 60000 });
await maybeLogin(page, config.apps.fleet, "fleet");
await page.goto("https://live-wf.webfleet.com/web/map", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(4000);

const search = page.locator("input.t3sel-object-filter-bar-item-search").first();
await search.waitFor({ state: "visible", timeout: 30000 });
await search.click({ force: true });
await search.fill("");
await search.fill(truck);
await search.press("Enter");
await page.waitForTimeout(3000);

const clicked = await page.evaluate((truckId) => {
  const nodes = [...document.querySelectorAll("a, button, li, tr, [role='option'], [role='row'], div")];
  const needle = truckId.toUpperCase();
  for (const n of nodes) {
    const t = (n.innerText || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 220) continue;
    if (t.toUpperCase().includes(needle)) {
      n.click();
      return t.slice(0, 220);
    }
  }
  return null;
}, truck);
console.log("CLICKED:", clicked);
await page.waitForTimeout(3500);

const dump = await page.evaluate((truckId) => {
  const body = document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 6000);
  const interesting = [];
  for (const el of document.querySelectorAll("*")) {
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 280) continue;
    if (
      /location|area|address|position|geofence|boksburg|depot|boundary|inside|outside/i.test(text) ||
      text.toUpperCase().includes(truckId.toUpperCase())
    ) {
      interesting.push({
        tag: el.tagName,
        className: String(el.className || "").slice(0, 160),
        text: text.slice(0, 280),
      });
      if (interesting.length >= 100) break;
    }
  }
  return { url: location.href, body, interesting };
}, truck);

fs.writeFileSync("/tmp/webfleet-depot-probe.json", JSON.stringify(dump, null, 2));
await page.screenshot({ path: "/tmp/webfleet-depot-probe.png", fullPage: true });
console.log("URL:", dump.url);
console.log("BODY:", dump.body.slice(0, 2500));
console.log("INTERESTING COUNT:", dump.interesting.length);
console.log(JSON.stringify(dump.interesting.slice(0, 50), null, 2));
await browser.close();
