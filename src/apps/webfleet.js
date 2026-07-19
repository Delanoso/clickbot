import {
  clickIfPresentFrom,
  fillFrom,
  locate,
  readTextFrom,
} from "../locate.js";
import { cleanDriverName } from "../utils/driverName.js";

/**
 * Webfleet map page helpers.
 * Work URL: https://live-wf.webfleet.com/web/map
 */
export async function ensureWebfleetMap(page, appConfig) {
  const workUrl = appConfig.workUrl;
  if (!workUrl) return;

  if (!isOnWorkUrl(page.url(), workUrl)) {
    await page.goto(workUrl, { waitUntil: "domcontentloaded" });
  }
}

function isOnWorkUrl(currentUrl, workUrl) {
  if (!workUrl) return true;
  if (currentUrl === workUrl) return true;

  try {
    const current = new URL(currentUrl);
    const work = new URL(workUrl);
    if (current.origin !== work.origin) return false;
    if (current.pathname.replace(/\/$/, "") !== work.pathname.replace(/\/$/, "")) {
      return false;
    }
    if (!work.hash) return true;
    return current.hash === work.hash || currentUrl.includes(work.hash.slice(1));
  } catch {
    return currentUrl.includes(workUrl);
  }
}

/**
 * Search a truck/vehicle and return the driver name from the DRIVER panel
 * (falls back to "VEHICLE - Name" list text).
 */
export async function lookupDriverInWebfleet(page, selectors, truckNumber) {
  // Prefer Vehicles list (screenshots); Assets is an alternative config.
  if (selectors.vehiclesTab) {
    await clickIfPresentFrom(page, selectors.vehiclesTab, { timeout: 8000 });
  }

  const searchSel = selectors.searchInput || { placeholder: "Search" };
  await fillFrom(page, searchSel, truckNumber);
  await locate(page, searchSel).press("Enter");
  await sleep(1000);

  // Click matching list row if present.
  const resultSel = selectors.resultItem;
  if (resultSel) {
    await clickIfPresentFrom(page, resultSel, { timeout: 8000 });
  } else {
    const row = page.getByText(new RegExp(truckNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).first();
    try {
      await row.waitFor({ state: "visible", timeout: 8000 });
      await row.click();
    } catch {
      return "";
    }
  }

  await sleep(800);

  // Preferred: DRIVER section Name field (may include phone numbers).
  if (selectors.driverNameResult) {
    try {
      const raw = await readTextFrom(page, selectors.driverNameResult, { timeout: 8000 });
      return cleanDriverName(raw);
    } catch {
      // fall through
    }
  }

  // Heuristic: label "Name" near DRIVER heading.
  try {
    const driverBlock = page.locator("text=DRIVER").first().locator("xpath=ancestor::*[self::section or self::div][1]");
    const nameValue = driverBlock.locator("text=Name").locator("xpath=following::*[1]");
    const raw = (await nameValue.innerText({ timeout: 5000 })).replace(/\s+/g, " ").trim();
    if (raw) return cleanDriverName(raw);
  } catch {
    // fall through
  }

  // Fallback: list label "TH2239 - Driver Name"
  try {
    const listText = await page
      .getByText(new RegExp(`${truckNumber}\\s*-\\s*.+`, "i"))
      .first()
      .innerText({ timeout: 5000 });
    return cleanDriverName(listText);
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
