import { locate } from "../locate.js";

/**
 * Webfleet Drivers list helpers.
 * Work URL: https://live-wf.webfleet.com/web/drivers/list
 *
 * Lookup: search by truck **number only** (no H/NH/AH/R prefix) → take the
 * top row's driver "No." (e.g. D3309). Truck numbers are unique, so the first
 * result is the correct vehicle.
 */
export async function ensureWebfleetMap(page, appConfig) {
  return ensureWebfleetDrivers(page, appConfig);
}

export async function ensureWebfleetDrivers(page, appConfig) {
  const workUrl =
    appConfig.workUrl || "https://live-wf.webfleet.com/web/drivers/list";
  if (!/live-wf\.webfleet\.com\/web\/drivers/i.test(page.url())) {
    await page.goto(workUrl, { waitUntil: "domcontentloaded" });
  }
  await page.getByText(/DRIVERS/i).first().waitFor({ timeout: 60000 }).catch(() => {});
  await sleep(800);
}

/**
 * Search the Drivers list by truck number digits and return the top row's
 * driver "No." (e.g. D3309).
 */
export async function lookupDriverInWebfleet(page, selectors, truckNumber) {
  // Ensure we are on Drivers (sidebar link) if still on map/login landing.
  if (!/\/drivers/i.test(page.url())) {
    const driversLink = page.locator('a[href*="/web/drivers"]').first();
    if (await driversLink.count()) {
      await driversLink.click().catch(() => {});
      await page.waitForURL(/\/drivers/i, { timeout: 15000 }).catch(() => {});
    } else {
      await page.goto("https://live-wf.webfleet.com/web/drivers/list", {
        waitUntil: "domcontentloaded",
      });
    }
    await page.getByText(/DRIVERS/i).first().waitFor({ timeout: 30000 }).catch(() => {});
    await sleep(800);
  }

  const digits = vehicleDigits(truckNumber);
  if (!digits) {
    return "";
  }

  const search = await resolveDriversSearchInput(page, selectors);
  await search.fill("", { force: true });
  await search.fill(digits, { force: true });
  await search.press("Enter");
  await sleep(1000);

  if (selectors.driverNumberResult) {
    try {
      const raw = await locate(page, selectors.driverNumberResult).innerText({
        timeout: 8000,
      });
      const normalized = normalizeDriverNo(raw);
      if (normalized) return normalized;
    } catch {
      // fall through
    }
  }

  return readTopDriverNoForDigits(page, digits);
}

/**
 * Extract the numeric part of a Lytx vehicle label.
 * "NH2404" → "2404", "H2110 - Sold" → "2110", "Demo 95" → "95"
 */
export function vehicleSearchTokens(truckNumber) {
  const digits = vehicleDigits(truckNumber);
  const full = String(truckNumber || "").trim();
  const leading = full.split(/\s+[–—-]\s+|\s+/)[0] || full;
  return { leading, digits };
}

export function vehicleDigits(truckNumber) {
  const full = String(truckNumber || "").trim();
  const leading = full.split(/\s+[–—-]\s+|\s+/)[0] || full;
  return (
    (leading.match(/(\d{3,})/) ||
      full.match(/(\d{3,})/) ||
      full.match(/(\d+)/) ||
      leading.match(/(\d+)/) || [null, ""])[1] || ""
  );
}

/**
 * After a digits-only search, take the first row whose Vehicle id contains
 * that number. (Webfleet also matches phone digits, so we cannot blindly
 * use table row 1 — but truck numbers are unique, so the first vehicle hit
 * is correct.)
 */
async function readTopDriverNoForDigits(page, digits) {
  try {
    const raw = await page.evaluate((digits) => {
      const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const esc = digits.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Vehicle id must contain this number as its numeric core
      // e.g. 2404 matches NH2404 / AH2404, not R2294.
      const vehicleHasNumber = (vehicleId) => {
        const id = vehicleId.split(/[–—-]/)[0].trim();
        const idDigits = (id.match(/(\d+)/) || [])[1] || "";
        return idDigits === digits;
      };

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

      const rowEls = table
        ? [...table.querySelectorAll("tbody tr")]
        : [...document.querySelectorAll('[role="row"]')].filter(
            (r) => r.querySelectorAll('[role="cell"]').length > 2
          );

      for (const tr of rowEls) {
        const cells = [
          ...tr.querySelectorAll(table ? "td" : '[role="cell"]'),
        ].map((c) => normalize(c.innerText));
        if (!cells.some(Boolean)) continue;
        const vehicle = cells[vehicleIdx] || "";
        if (!vehicleHasNumber(vehicle)) continue;

        const no = cells[noIdx] || "";
        if (
          !no ||
          /^—+$/.test(no) ||
          /^(no driver|n\/a|na|none|unknown|-|--)$/i.test(no)
        ) {
          return "";
        }
        return no;
      }
      return "";
    }, digits);

    return normalizeDriverNo(raw);
  } catch {
    return "";
  }
}

function normalizeDriverNo(raw) {
  const value = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value || /^—+$/.test(value)) return "";
  if (/^(no driver|n\/a|na|none|unknown|-|--)$/i.test(value)) return "";
  const token = value.split(/\s+/)[0];
  if (/^(no|n\/a|na|none|unknown)$/i.test(token)) return "";
  if (!/^[A-Za-z]{0,4}\d{2,}$/i.test(token) && !/^[A-Za-z]+\d+/i.test(token)) {
    if (/\d{6,}/.test(value.replace(/\s/g, ""))) return "";
  }
  return token;
}

async function resolveDriversSearchInput(page, selectors) {
  if (selectors.searchInput) {
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
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  const forced = candidates.last();
  await forced.waitFor({ state: "attached", timeout: 10000 });
  return forced;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
