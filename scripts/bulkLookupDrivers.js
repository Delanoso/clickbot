/**
 * Bulk-test Webfleet Drivers → No. lookup for many trucks.
 * Usage: node scripts/bulkLookupDrivers.js
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { loadEnvFile } from "../src/loadEnv.js";
import { loadConfig } from "../src/config.js";
import { maybeLogin } from "../src/login.js";
import {
  ensureWebfleetDrivers,
  lookupDriverInWebfleet,
} from "../src/apps/webfleet.js";
import {
  resolveDriverName,
  shouldForceDefaultDriver,
} from "../src/utils/driverName.js";

loadEnvFile();

const trucks = `
Demo 95, H1864, H1880, H1902, H1905, H1908, H1909, H1911, H2002, H2010, H2013, H2019, H2021, H2105, H2106, H2110 - Sold, H2111, H2117, H2119, H2120, H2121, H2122, H2123, H2125, H2127, H2131, H2134, H2136, H2138, H2140, H2142, H2144, H2150, H2151, H2154, H2155, H2158, H2162, H2163, H2164, H2165, H2166, H2167, H2169, H2174, H2176, H2177, H2179, H2181, H2182, H2184, H2187, H2188, H2189, H2190, H2198, H2200, H2203, H2205, H2207, H2208, H2209, H2210, H2211, H2213, H2214, H2215, H2216, H2217, H2220, H2223, H2225, H2227, H2230, H2234, H2241, H2246, H2248, H2249, H2250, H2251, H2253, H2256, H2257, H2260, H2261, H2262, H2264, H2266, H2267, H2270, H2271, H2273, H2275, H2277, H2280, H2281, H2282, H2283, H2284, H2304, H2305, H2306, H2308, H2310, H2312, H2316, H2317, H2318, H2320, H2321, H2322, H2323, H2324, H2351, H2352, H2353, H2354, H2355, H2357, H2358, H2359, H2425, H2427, H2431, H2432, H2433, H2434, H2436, H2437, H2439, H2440, H2446, H2451, H2456, H2457, H2458, H2459, H2466, H2467, H2468, H2470, H2471, H2472, H2474, H2475, H2477, H2478, H2480, H2505, H2507, H2508, H2509, H2511, H2514, H2515, H2519, H2632, H2634, H2639, NH2008, NH2371, NH2373, NH2374, NH2400, NH2402, NH2403, NH2404, NH2405, NH2408, NH2409, NH2410, NH2412, NH2413, NH2414, NH2415, NH2416, NH2418, NH2420, NH2421, NH2444, NH2445, NH2447, NH2448, NH2449, NH2483, NH2484, NH2485, NH2486, NH2488, NH2555, NR2026, R2050, R2051, R2052, R2053, R2054, R2056, R2060, R2061, R2066, R2067, R2068, R2069, R2070, R2071, R2072, R2074, R2291, R2292, R2293, R2295, R2491, R2492, R2606, R2608, R2610, R2611, R2612, RL2075, TH2237, TH2239, TH2240
`
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

const config = loadConfig({ configPath: "config/local.json" });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(config.apps.fleet.url, { waitUntil: "domcontentloaded" });
await maybeLogin(page, config.apps.fleet, "fleet");
await ensureWebfleetDrivers(page, config.apps.fleet);

const found = [];
const unknown = [];
const soldSkip = [];
const errors = [];

console.log(`Bulk lookup of ${trucks.length} trucks on Webfleet Drivers list...\n`);

for (let i = 0; i < trucks.length; i += 1) {
  const truck = trucks[i];
  process.stdout.write(`[${i + 1}/${trucks.length}] ${truck} ... `);

  if (shouldForceDefaultDriver(truck)) {
    soldSkip.push(truck);
    console.log("Driver Unknown (Sold/LDV/accident rule)");
    continue;
  }

  try {
    const raw = await lookupDriverInWebfleet(
      page,
      config.apps.fleet.selectors,
      truck
    );
    const resolved = resolveDriverName(raw, config);
    if (resolved.usedFallback) {
      unknown.push({ truck, reason: resolved.reason || "empty" });
      console.log(`Driver Unknown (${resolved.reason || "no driver No."})`);
    } else {
      found.push({ truck, no: resolved.name });
      console.log(resolved.name);
    }
  } catch (error) {
    errors.push({ truck, error: error.message || String(error) });
    console.log(`ERROR: ${error.message || error}`);
    // Recover page if needed
    await ensureWebfleetDrivers(page, config.apps.fleet).catch(() => {});
  }
}

await browser.close();

const summary = {
  total: trucks.length,
  found: found.length,
  unknown: unknown.length,
  soldSkip: soldSkip.length,
  errors: errors.length,
  foundList: found,
  unknownList: unknown,
  soldSkipList: soldSkip,
  errorList: errors,
};

writeFileSync("/tmp/bulk-driver-lookup.json", JSON.stringify(summary, null, 2));

console.log("\n======== SUMMARY ========");
console.log(`Total:              ${summary.total}`);
console.log(`Found driver No.:   ${summary.found}`);
console.log(`Driver Unknown:     ${summary.unknown} (no driver / empty No.)`);
console.log(`Sold/LDV/accident:  ${summary.soldSkip} (forced Driver Unknown)`);
console.log(`Errors:             ${summary.errors}`);
console.log(`\nFull JSON: /tmp/bulk-driver-lookup.json`);
