import { locate } from "../locate.js";

/**
 * Webfleet Drivers list helpers.
 * Work URL: https://live-wf.webfleet.com/web/drivers/list
 *
 * Lookup (double search):
 * 1) Search with the Lytx vehicle id (H2241, NH2404, R2610, …)
 * 2) If no hit, search with digits only (2241) and match the Vehicle column
 *    so phone-number hits in Name are ignored.
 *
 * Returns the driver "No." (e.g. D3309), not the Name.
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

export async function ensureWebfleetDepotMonitor(page, appConfig, monitorConfig = {}) {
  const workUrl =
    monitorConfig.workUrl ||
    appConfig.monitor?.workUrl ||
    "https://live-wf.webfleet.com/web/map";

  if (!page.url().startsWith(workUrl)) {
    await page.goto(workUrl, { waitUntil: "domcontentloaded" });
  }

  const search = await resolveMonitorSearchInput(page, appConfig, monitorConfig);
  await search.waitFor({ state: "visible", timeout: 60000 });
  await sleep(800);
}

/**
 * Search the Drivers list and return the driver "No." (e.g. D3309).
 */
export async function lookupDriverInWebfleet(page, selectors, truckNumber) {
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
  if (!leading && !digits) return "";

  // 1) Search with full Lytx id (includes prefix).
  let raw = await searchAndReadDriverNo(page, search, selectors, leading, {
    leading,
    digits,
  });
  if (raw) return raw;

  // 2) Retry with digits only (handles AH2241 / SH2241 when Lytx has H2241).
  //    Matching still requires the Vehicle column number — not Name/phone hits.
  if (digits && digits !== leading && digits.length >= 3) {
    raw = await searchAndReadDriverNo(page, search, selectors, digits, {
      leading,
      digits,
    });
    if (raw) return raw;
  }

  return "";
}

export async function lookupTruckAreaInWebfleet(page, appConfig, truckNumber, monitorConfig = {}) {
  const selectors = monitorConfig.selectors || {};
  const search = await resolveMonitorSearchInput(page, appConfig, monitorConfig);
  const query = String(truckNumber || "").trim();
  if (!query) {
    return { found: false, locationText: "", rawText: "", source: "empty_query" };
  }

  await search.click({ force: true }).catch(() => {});
  await search.fill("", { force: true });
  await search.fill(query, { force: true });
  await search.press("Enter").catch(() => {});
  await sleep(monitorConfig.searchDelayMs ?? 1500);

  await clickMonitorResultIfPresent(page, selectors);
  await clickTruckResultByText(page, query);
  await sleep(monitorConfig.resultDelayMs ?? 1000);

  const locationText =
    (await readFirstVisibleText(page, selectors.locationText, { timeout: 2500 })) ||
    (await readLocationFromTable(page, query, selectors)) ||
    (await readLocationFromDetailPanel(page, query)) ||
    "";

  const detailText = await readFirstVisibleText(page, selectors.detailText, {
    timeout: 1500,
    allowMany: true,
  });

  const rawText = [locationText, detailText].filter(Boolean).join(" | ");
  return {
    found: Boolean(locationText || detailText),
    locationText: locationText || detailText || "",
    rawText,
    source: locationText ? "locationText" : detailText ? "detailText" : "none",
  };
}

async function searchAndReadDriverNo(page, search, selectors, query, tokens) {
  if (!query) return "";
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
 * "H2110 - Sold" → leading H2110, digits 2110
 * "Demo 95" → leading Demo, digits 95
 * "NH2404" → leading NH2404, digits 2404
 */
export function vehicleSearchTokens(truckNumber) {
  const full = String(truckNumber || "").trim();
  const leading = full.split(/\s+[–—-]\s+|\s+/)[0] || full;
  const digits = vehicleDigits(truckNumber);
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
 * Pick driver No. from the Drivers table using Vehicle-column matching only
 * (never Name/phone). Prefers exact / prefix variants, then unique digit match.
 */
async function readDriverNoFromTable(page, { leading, digits }) {
  try {
    const raw = await page.evaluate(
      ({ leading, digits }) => {
        const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const esc = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const leadingEsc = esc(leading);

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

            if (leading && new RegExp(`^${leadingEsc}$`, "i").test(vehicleId)) {
              score = 100; // exact H2021
            } else if (
              leading &&
              new RegExp(`^${leadingEsc}[A-Za-z0-9]+$`, "i").test(vehicleId)
            ) {
              score = 90; // R2610 → R2610MH
            } else if (
              leading &&
              new RegExp(`^[A-Za-z]*${leadingEsc}$`, "i").test(vehicleId)
            ) {
              score = 85; // H2241 → AH2241 / SH2241
            } else if (digits && digits.length >= 3 && vehicleDigits === digits) {
              score = 70; // same number core only
            }

            return { ...row, vehicleId, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score);

        if (!scored.length) return "";

        const top = scored[0].score;
        const tied = scored.filter((r) => r.score === top);

        // Ambiguous digit-only hits → do not guess (phone search noise / collisions).
        if (top <= 70 && tied.length > 1) {
          return "";
        }

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

async function resolveMonitorSearchInput(page, appConfig, monitorConfig) {
  const preferredCss = "input.t3sel-object-filter-bar-item-search";
  const preferred = page.locator(preferredCss).first();
  if (await preferred.isVisible().catch(() => false)) {
    return preferred;
  }

  const selector =
    monitorConfig.selectors?.searchInput ||
    appConfig.monitor?.selectors?.searchInput ||
    appConfig.selectors?.searchInput;

  if (selector) {
    // Prefer a visible match when CSS can hit multiple Search inputs on the map.
    if (typeof selector === "string" || selector.css || selector.placeholder) {
      const candidates =
        typeof selector === "string"
          ? page.locator(selector)
          : selector.css
            ? page.locator(selector.css)
            : page.getByPlaceholder(selector.placeholder, {
                exact: Boolean(selector.exact),
              });
      const count = await candidates.count();
      for (let i = 0; i < count; i += 1) {
        const candidate = candidates.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }

    const locator = locate(page, selector);
    try {
      await locator.waitFor({ state: "visible", timeout: 5000 });
      return locator;
    } catch {
      // continue to generic fallback
    }
  }

  return resolveDriversSearchInput(page, appConfig.selectors || {});
}

async function clickTruckResultByText(page, truckNumber) {
  const needle = String(truckNumber || "").trim().toUpperCase();
  if (!needle) return false;

  try {
    const row = page
      .locator(
        "button.t3sel-vehicle-compact-list-row, li.t3sel-list-row, .t3sel-vehicle-compact-list-row"
      )
      .filter({ hasText: new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
      .first();
    if (await row.isVisible().catch(() => false)) {
      await row.click({ force: true });
      return true;
    }
  } catch {
    // fall through
  }

  try {
    return await page.evaluate((query) => {
      const nodes = [
        ...document.querySelectorAll(
          "button.t3sel-vehicle-compact-list-row, li.t3sel-list-row, a, button, [role='option'], [role='row']"
        ),
      ];
      for (const node of nodes) {
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 220) continue;
        if (!text.toUpperCase().includes(query)) continue;
        node.click();
        return true;
      }
      return false;
    }, needle);
  } catch {
    return false;
  }
}

async function clickMonitorResultIfPresent(page, selectors) {
  const resultSelector = selectors.resultItem;
  if (!resultSelector) return false;

  try {
    const result = locate(page, resultSelector);
    await result.waitFor({ state: "visible", timeout: 2500 });
    await result.click();
    return true;
  } catch {
    return false;
  }
}

async function readFirstVisibleText(page, selector, { timeout = 2500, allowMany = false } = {}) {
  if (!selector) return "";

  const selectors = Array.isArray(selector) ? selector : [selector];
  for (const item of selectors) {
    try {
      const locator = locate(page, item);
      await locator.waitFor({ state: "visible", timeout });
      const text = allowMany ? await locator.allInnerTexts() : [await locator.innerText()];
      const value = text
        .map((entry) => String(entry || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" | ");
      if (value) return value;
    } catch {
      // try next selector
    }
  }

  return "";
}

async function readLocationFromDetailPanel(page, truckNumber) {
  try {
    return await page.evaluate((truckId) => {
      const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const needle = normalize(truckId).toUpperCase();

      // Preferred: Webfleet map vehicle compact-list row caption.
      const rows = [
        ...document.querySelectorAll(
          "button.t3sel-vehicle-compact-list-row, li.t3sel-list-row, figcaption.t3sel-vehicle-compact-list-caption"
        ),
      ];
      for (const row of rows) {
        const text = normalize(row.innerText);
        if (!text.toUpperCase().includes(needle)) continue;
        // Strip leading "R2609MH– Driver Name" and keep location/time portion when present.
        const afterComma = text.includes(",")
          ? text.slice(text.indexOf(",") + 1).trim()
          : "";
        if (afterComma) return afterComma;
        return text;
      }

      const body = normalize(document.body.innerText);
      const labels = ["Location", "Area", "Address", "Position", "Geofence"];
      for (const label of labels) {
        const re = new RegExp(`${label}\\s*[:\\n]?\\s*([^\\n]{3,180})`, "i");
        const match = body.match(re);
        if (match?.[1]) {
          const value = normalize(match[1]);
          if (value && !/^details$/i.test(value)) return value;
        }
      }

      const lines = body
        .split(/\n+/)
        .map(normalize)
        .filter(Boolean);
      const truckLine = lines.find((line) => line.toUpperCase().includes(needle));
      if (truckLine) {
        const afterComma = truckLine.includes(",")
          ? truckLine.slice(truckLine.indexOf(",") + 1).trim()
          : "";
        return afterComma || truckLine;
      }

      return "";
    }, truckNumber);
  } catch {
    return "";
  }
}

async function readLocationFromTable(page, truckNumber, selectors) {
  try {
    const raw = await page.evaluate(
      ({
        truckNumber,
        resultRow,
        vehicleColumnName,
        locationColumnName,
        locationColumnIndex,
      }) => {
        const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const query = normalize(truckNumber).toLowerCase();
        const rows = resultRow
          ? [...document.querySelectorAll(resultRow)]
          : [...document.querySelectorAll("table tbody tr, [role='row']")];

        for (const row of rows) {
          const cells = [...row.querySelectorAll("td, [role='cell']")].map((cell) =>
            normalize(cell.innerText)
          );
          if (!cells.length) continue;

          const rowText = cells.join(" ").toLowerCase();
          if (!rowText.includes(query)) continue;

          if (vehicleColumnName && locationColumnName) {
            const table = row.closest("table");
            const headers = table
              ? [...table.querySelectorAll("thead th")].map((th) => normalize(th.innerText))
              : [];
            const vehicleIdx = headers.findIndex(
              (header) => normalize(header).toLowerCase() === normalize(vehicleColumnName).toLowerCase()
            );
            const locationIdx = headers.findIndex(
              (header) => normalize(header).toLowerCase() === normalize(locationColumnName).toLowerCase()
            );
            if (vehicleIdx >= 0 && locationIdx >= 0) {
              const vehicleValue = cells[vehicleIdx] || "";
              if (vehicleValue.toLowerCase().includes(query)) {
                return cells[locationIdx] || "";
              }
            }
          }

          const preferredIndex = Number.isInteger(locationColumnIndex)
            ? locationColumnIndex
            : cells.length - 1;
          return cells[preferredIndex] || cells.join(" | ");
        }

        return "";
      },
      {
        truckNumber,
        resultRow: typeof selectors.resultRow === "string" ? selectors.resultRow : null,
        vehicleColumnName: selectors.vehicleColumnName || "Vehicle",
        locationColumnName: selectors.locationColumnName || "Location",
        locationColumnIndex: selectors.locationColumnIndex,
      }
    );

    return String(raw || "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
