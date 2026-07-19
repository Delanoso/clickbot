import {
  clickIfPresentFrom,
  fillFrom,
  locate,
} from "../locate.js";
import { cleanDriverName } from "../utils/driverName.js";

/**
 * Webfleet map page helpers.
 * Work URL: https://live-wf.webfleet.com/web/map
 */
export async function ensureWebfleetMap(page, appConfig) {
  const workUrl = appConfig.workUrl || "https://live-wf.webfleet.com/web/map";
  if (!/live-wf\.webfleet\.com\/web\/map/i.test(page.url())) {
    await page.goto(workUrl, { waitUntil: "domcontentloaded" });
  }
  await page.getByText(/VEHICLES/i).first().waitFor({ timeout: 60000 }).catch(() => {});
}

/**
 * Search a truck/vehicle and return the driver name from the list / DRIVER panel.
 */
export async function lookupDriverInWebfleet(page, selectors, truckNumber) {
  if (selectors.vehiclesTab) {
    await clickIfPresentFrom(page, selectors.vehiclesTab, { timeout: 8000 });
  } else {
    await clickIfPresentFrom(page, { text: "VEHICLES" }, { timeout: 5000 });
  }

  const search = await resolveSearchInput(page, selectors);
  await search.fill("");
  // Use leading id token so "H2110 - Sold" still finds H2110 in Webfleet.
  const searchTerm = String(truckNumber).split(/\s+[–—-]\s+|\s+/)[0];
  await search.fill(searchTerm);
  await search.press("Enter");
  await sleep(1500);

  // Click matching list row if present.
  const row = page
    .getByText(
      new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    )
    .first();
  try {
    await row.waitFor({ state: "visible", timeout: 8000 });
    await row.click();
  } catch {
    return "";
  }

  await sleep(1000);

  if (selectors.driverNameResult) {
    try {
      const raw = await locate(page, selectors.driverNameResult).innerText({
        timeout: 8000,
      });
      return cleanDriverName(raw);
    } catch {
      // fall through
    }
  }

  // Prefer DRIVER section Name value when the details panel is open.
  try {
    const driverLabel = page.getByText(/^DRIVER$/i).first();
    if (await driverLabel.isVisible({ timeout: 2000 })) {
      const panelText = await driverLabel
        .locator("xpath=ancestor::*[contains(@class,'panel') or self::section or self::div][1]")
        .innerText();
      const nameLine = panelText.match(/Name\s*\n?\s*([^\n]+)/i);
      if (nameLine?.[1]) {
        return cleanDriverName(nameLine[1]);
      }
    }
  } catch {
    // fall through
  }

  // Fallback: list label "H2118 – Driver Name" or "H2118 - Driver Name"
  try {
    const listText = await page
      .getByText(
        new RegExp(
          `${truckNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[–-]\\s*.+`,
          "i"
        )
      )
      .first()
      .innerText({ timeout: 5000 });
    return cleanDriverName(listText.replace(/[–—]/g, "-"));
  } catch {
    return "";
  }
}

async function resolveSearchInput(page, selectors) {
  if (selectors.searchInput) {
    const locator = locate(page, selectors.searchInput);
    try {
      await locator.waitFor({ state: "visible", timeout: 5000 });
      return locator;
    } catch {
      // continue to fallbacks
    }
  }

  const candidates = page.locator('input[type="search"], input[placeholder="Search"]');
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  // Last resort: fill the first search input even if Playwright considers it hidden.
  const forced = candidates.first();
  await forced.waitFor({ state: "attached", timeout: 10000 });
  return forced;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
