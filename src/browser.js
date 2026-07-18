import { chromium } from "playwright";

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

  await Promise.all([
    dispatchPage.goto(config.apps.dispatch.url, { waitUntil: "domcontentloaded" }),
    fleetPage.goto(config.apps.fleet.url, { waitUntil: "domcontentloaded" }),
  ]);

  return {
    browser,
    context,
    pages: {
      dispatch: dispatchPage,
      fleet: fleetPage,
    },
  };
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
