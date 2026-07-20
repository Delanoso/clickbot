import { locate } from "../locate.js";

/**
 * Webfleet Drivers list helpers.
 * Work URL: https://live-wf.webfleet.com/web/drivers/list
 *
 * Lookup: search by truck/vehicle id → read the matching row's "No." (driver id).
 *
 * Lytx often uses H/R/NH… while Webfleet may use AH/SH/NH… for the same number.
 * Matching prefers exact id, then suffix/prefix variants, then shared digits.
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
  const { leading, digits } = vehicleSearchTokens(truckNumber);

  // 1) Search with the Lytx id (H2241, NH2008, R2610, …).
  let raw = await searchAndReadDriverNo(page, search, selectors, leading, {
    leading,
    digits,
  });
  if (raw) return raw;

  // 2) Retry with digits only so Webfleet can surface AH2241 / SH2241 / etc.
  if (digits && digits !== leading && digits.length >= 3) {
    raw = await searchAndReadDriverNo(page, search, selectors, digits, {
      leading,
      digits,
    });
    if (raw) return raw;
  }

  return "";
}

async function searchAndReadDriverNo(page, search, selectors, query, tokens) {
  await search.fill("", { force: true });
  await search.fill(query, { force: true });
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

  return readDriverNoFromTable(page, tokens);
}

/**
 * Build search tokens from a Lytx vehicle label.
 * "H2110 - Sold" → leading H2110, digits 2110
 * "Demo 95" → leading Demo, digits 95
 */
export function vehicleSearchTokens(truckNumber) {
  const full = String(truckNumber || "").trim();
  const leading = full.split(/\s+[–—-]\s+|\s+/)[0] || full;
  const digits =
    (leading.match(/(\d{3,})/) ||
      full.match(/(\d{3,})/) ||
      full.match(/(\d+)/) ||
      leading.match(/(\d+)/) || [null, ""])[1] || "";
  return { leading, digits };
}

/**
 * Read "No." from the Drivers table row whose Vehicle best matches the Lytx id.
 * Handles Webfleet prefixes: H2241 ↔ AH2241 / SH2241, R2610 ↔ R2610MH.
 */
async function readDriverNoFromTable(page, { leading, digits }) {
  try {
    const raw = await page.evaluate(
      ({ leading, digits }) => {
        const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const leadingEsc = esc(leading);
        const digitsEsc = digits ? esc(digits) : "";

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
            const vehicleDigits = (vehicleId.match(/(\d+)/) || [])[1] || "";
            let score = 0;

            // Exact: H2021 === H2021
            if (new RegExp(`^${leadingEsc}$`, "i").test(vehicleId)) score = 100;
            // Lytx id is a prefix of Webfleet id: R2610 → R2610MH
            else if (new RegExp(`^${leadingEsc}[A-Za-z0-9]+$`, "i").test(vehicleId))
              score = 90;
            // Webfleet adds a letter prefix: H2241 → AH2241 / SH2241
            else if (new RegExp(`^[A-Za-z]*${leadingEsc}$`, "i").test(vehicleId))
              score = 85;
            // Same number core (prefer longer digit runs): 2241
            else if (
              digitsEsc &&
              digits.length >= 3 &&
              vehicleDigits === digits
            )
              score = 70;
            // Contains Lytx id as a token somewhere in the vehicle cell
            else if (
              new RegExp(`(?:^|[^A-Za-z0-9])${leadingEsc}(?![A-Za-z0-9])`, "i").test(
                row.vehicle
              )
            )
              score = 50;

            return { ...row, vehicleId, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score);

        if (!scored.length) return "";

        // If several digit-only matches, prefer the shortest vehicle id
        // (H2241 over something like XXH2241EXTRA) among top score.
        const top = scored[0].score;
        const tied = scored.filter((r) => r.score === top);
        tied.sort((a, b) => a.vehicleId.length - b.vehicleId.length);
        const best = tied[0];
        const no = normalize(best.no);

        if (
          !no ||
          /^—+$/.test(no) ||
          /^(no driver|n\/a|na|none|unknown|-|--)$/i.test(no)
        ) {
          return "";
        }
        return no;
      },
      { leading, digits }
    );

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
