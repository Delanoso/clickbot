import { chromium } from "playwright";
import { maybeLogin } from "./login.js";

/**
 * Launch Chromium and open both web apps in separate pages
 * so the bot can switch between them without reloading.
 */
export async function openApps(config) {
  const browser = await chromium.launch({
    headless: Boolean(config.headless),
    slowMo: config.slowMoMs ?? 0,
  });

  const context = await browser.newContext();

  const dispatchPage = await context.newPage();
  const fleetPage = await context.newPage();

  // Open dispatch (Lytx) first so login can complete before the loop starts.
  await dispatchPage.goto(config.apps.dispatch.url, {
    waitUntil: "domcontentloaded",
  });
  await maybeLogin(dispatchPage, config.apps.dispatch, "dispatch");
  // Do not deep-link immediately — Lytx often redirects hash routes to dashboard.
  // ensureLytxAssignPage() opens Assign Drivers via the UNASSIGNED DRIVERS tile.

  const fleetUrl = config.apps.fleet?.url;
  if (fleetUrl && !String(fleetUrl).includes("example.com")) {
    await fleetPage.goto(fleetUrl, { waitUntil: "domcontentloaded" });
    await maybeLogin(fleetPage, config.apps.fleet, "fleet");
    if (config.apps.fleet.workUrl) {
      await fleetPage.goto(config.apps.fleet.workUrl, {
        waitUntil: "domcontentloaded",
      });
    }
  } else {
    console.log("[fleet] URL not configured yet — leaving second tab blank.");
  }

  return {
    browser,
    context,
    pages: {
      dispatch: dispatchPage,
      fleet: fleetPage,
    },
  };
}

/**
 * Lytx-only browser session (for tasks that do not need Webfleet).
 */
export async function openLytxOnly(config) {
  const browser = await chromium.launch({
    headless: Boolean(config.headless),
    slowMo: config.slowMoMs ?? 0,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(config.apps.dispatch.url, {
    waitUntil: "domcontentloaded",
  });
  await maybeLogin(page, config.apps.dispatch, "dispatch");

  return { browser, context, page };
}

/**
 * Lytx Video Search / Vehicles account (separate login from Driver Safety).
 */
export async function openLytxVehicles(config) {
  const vehicles = config.apps?.vehicles;
  if (!vehicles?.url) {
    throw new Error("apps.vehicles.url is required for wake-trucks");
  }

  const browser = await chromium.launch({
    headless: Boolean(config.headless),
    slowMo: config.slowMoMs ?? 0,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(vehicles.url, { waitUntil: "domcontentloaded" });
  await maybeLogin(page, vehicles, "vehicles");

  const workUrl = vehicles.workUrl || "https://app.lytx.com/";
  if (!page.url().includes("app.lytx.com")) {
    await page.goto(workUrl, { waitUntil: "domcontentloaded" });
  }

  return { browser, context, page };
}

const LOW_MEMORY_CHROMIUM_ARGS = [
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-translate",
  "--mute-audio",
  "--no-first-run",
  "--font-render-hinting=none",
];

/**
 * Webfleet-only browser session (for tasks that do not need Lytx).
 * @param {{ lowMemory?: boolean }} [options]
 */
export async function openWebfleetOnly(config, options = {}) {
  const browser = await chromium.launch({
    headless: Boolean(config.headless),
    slowMo: config.slowMoMs ?? 0,
    args: options.lowMemory ? LOW_MEMORY_CHROMIUM_ARGS : undefined,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const fleetUrl = config.apps.fleet?.url;
  if (!fleetUrl || String(fleetUrl).includes("example.com")) {
    throw new Error("apps.fleet.url is required for Webfleet-only tasks");
  }

  await page.goto(fleetUrl, {
    waitUntil: "domcontentloaded",
  });
  await maybeLogin(page, config.apps.fleet, "fleet");

  return { browser, context, page };
}

export async function readText(page, selector, { timeout = 15000 } = {}) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout });
  const text = await locator.innerText();
  return text.replace(/\s+/g, " ").trim();
}

export async function fillInput(page, selector, value, { timeout = 15000 } = {}) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout });
  await locator.fill("");
  await locator.fill(String(value));
}

export async function clickIfPresent(page, selector, { timeout = 5000 } = {}) {
  if (!selector) {
    return false;
  }
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: "visible", timeout });
    await locator.click();
    return true;
  } catch {
    return false;
  }
}
