import { clickIfPresentFrom, locate } from "../locate.js";

/**
 * Webfleet Drivers list helpers.
 * Work URL: https://live-wf.webfleet.com/web/drivers/list
 *
 * Lookup: search by truck/vehicle id → read the matching row's "No." (driver id).
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
 * Search the Drivers list by truck number and return the driver "No." (e.g. D3309).
 * Does not return the Name column — Lytx assigns more reliably by driver id.
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

  const search = await resolveDriversSearchInput(page, selectors);
  const searchTerm = String(truckNumber).split(/\s+[–—-]\s+|\s+/)[0];
  await search.fill("", { force: true });
  await search.fill(searchTerm, { force: true });
  await search.press("Enter");
  await sleep(1500);

  if (selectors.driverNumberResult) {
    try {
      const raw = await locate(page, selectors.driverNumberResult).innerText({
        timeout: 8000,
      });
      return normalizeDriverNo(raw);
    } catch {
      // fall through
    }
  }

  return readDriverNoFromTable(page, searchTerm);
}

/**
 * Read "No." from the Drivers table row whose Vehicle matches the truck id.
 */
async function readDriverNoFromTable(page, searchTerm) {
  try {
    const raw = await page.evaluate((term) => {
      const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const idRe = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
      const prefixRe = new RegExp(`^\\s*${escaped}[A-Za-z0-9]*\\b`, "i");

      const table = document.querySelector("table");
      const headers = table
        ? [...table.querySelectorAll("thead th")].map((h) => normalize(h.innerText))
        : [...document.querySelectorAll('[role="columnheader"]')].map((h) =>
            normalize(h.innerText)
          );

      let noIdx = headers.findIndex((h) => /^No\.?$/i.test(h));
      let vehicleIdx = headers.findIndex((h) => /^Vehicle$/i.test(h));
      // Headers often start with an empty avatar column.
      if (noIdx < 0) noIdx = 2;
      if (vehicleIdx < 0) vehicleIdx = 3;

      const rowEls = table
        ? [...table.querySelectorAll("tbody tr")]
        : [...document.querySelectorAll('[role="row"]')].filter(
            (r) => r.querySelectorAll('[role="cell"]').length > 2
          );

      const rows = rowEls.map((tr) => {
        const cells = [
          ...tr.querySelectorAll(table ? "td" : '[role="cell"]'),
        ].map((c) => normalize(c.innerText));
        return {
          no: cells[noIdx] || "",
          vehicle: cells[vehicleIdx] || "",
          cells,
        };
      });

      const scored = rows
        .map((row) => {
          const vehicleId = row.vehicle.split(/[–—-]/)[0].trim();
          let score = 0;
          if (new RegExp(`^${escaped}$`, "i").test(vehicleId)) score = 100;
          else if (prefixRe.test(vehicleId)) score = 80;
          else if (idRe.test(row.vehicle)) score = 60;
          else if (row.cells.some((c) => idRe.test(c))) score = 20;
          return { ...row, vehicleId, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);

      if (!scored.length) return "";
      const best = scored[0];
      const no = normalize(best.no);
      // Driver numbers look like D3309 / DR3995 / ND1221 / Z2888
      if (!no || /^—+$/.test(no)) return "";
      return no;
    }, searchTerm);

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
  // Keep the id token only (first word), e.g. "D3309"
  const token = value.split(/\s+/)[0];
  if (!/^[A-Za-z]{0,4}\d{2,}$/i.test(token) && !/^[A-Za-z]+\d+/i.test(token)) {
    // Still allow unusual ids; just reject obvious names-with-phones.
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
      // continue — pick a visible search field
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

  // Hidden duplicate search fields exist on this page — force the last one.
  const forced = candidates.last();
  await forced.waitFor({ state: "attached", timeout: 10000 });
  return forced;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
