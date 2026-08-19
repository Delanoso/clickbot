/**
 * Lytx Video Search → Vehicles → Wake / Retry automation.
 */
import { classifyCameraScanRow } from "../web/cameraMarks.js";
import { parseDeviceNumber } from "../utils/lastCommunicated.js";

const VEHICLE_LIST_URLS = [
  "https://app.lytx.com/#/lvs/vehicles",
  "https://app.lytx.com/#/video-search/vehicles",
  "https://app.lytx.com/#/video-search/vehicle-list",
  "https://app.lytx.com/#/vehicles",
  "https://app.lytx.com/",
];

export async function ensureVehiclesListPage(page, appConfig = {}, wakeConfig = {}) {
  const configured = [
    wakeConfig.vehiclesListUrl,
    appConfig.vehiclesListUrl,
    appConfig.workUrl,
    ...VEHICLE_LIST_URLS,
  ].filter(Boolean);

  for (const url of [...new Set(configured)]) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await sleep(1500);
      if (await isOnVehiclesList(page)) {
        console.log(`[wake] Vehicles list ready at ${page.url()}`);
        return;
      }
    } catch {
      /* try next URL */
    }
  }

  console.log("[wake] Direct URL did not land on Vehicles — using UI navigation");
  await navigateVehiclesViaUi(page);
  await waitForVehiclesList(page, 90000);
  console.log(`[wake] Vehicles list ready at ${page.url()}`);
}

async function navigateVehiclesViaUi(page) {
  // Top nav tab
  const videoSearch = page
    .getByRole("tab", { name: /Video Search/i })
    .or(page.getByRole("link", { name: /Video Search/i }))
    .or(page.locator("a, button, span, div").filter({ hasText: /^Video Search$/i }));
  if (await videoSearch.first().isVisible().catch(() => false)) {
    await clickStable(videoSearch.first());
    await sleep(1500);
  }

  // Left sidebar Vehicles
  const vehiclesNav = page
    .locator("a, button, [role='button'], [role='link'], [title], [aria-label]")
    .filter({ hasText: /^Vehicles$/i });
  if (await vehiclesNav.first().isVisible().catch(() => false)) {
    await clickStable(vehiclesNav.first());
    await sleep(1500);
    return;
  }

  const clickedIcon = await page.evaluate(() => {
    const links = [...document.querySelectorAll("a, button, [role='button']")];
    for (const el of links) {
      const title = `${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
      const text = (el.innerText || "").trim().toLowerCase();
      if (title.includes("vehicle") || text === "vehicles") {
        el.click();
        return true;
      }
    }
    return false;
  });
  if (clickedIcon) await sleep(1500);
}

async function isOnVehiclesList(page) {
  return page.evaluate(() => {
    const body = (document.body?.innerText || "").replace(/\s+/g, " ");
    const hasHeader = /VEHICLES/i.test(body);
    const hasLoadedRange = /VEHICLES\s+\d+\s*-\s*\d+\s+OF\s+\d+/i.test(body);
    const hasShowMenu = /Show:\s*\d+\s*Vehicle/i.test(body);
    const rowCount = document.querySelectorAll("table tbody tr, [role='row']").length;
    const hasDataRows = rowCount >= 10;
    return hasHeader && hasShowMenu && (hasLoadedRange || hasDataRows);
  });
}

async function waitForVehiclesList(page, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isOnVehiclesList(page)) return true;
    await sleep(800);
  }
  const snippet = await page
    .evaluate(() => (document.body?.innerText || "").slice(0, 500))
    .catch(() => "");
  throw new Error(
    `Vehicles list did not load (url=${page.url()}). Page starts: ${snippet.replace(/\s+/g, " ").slice(0, 200)}`
  );
}

async function readCurrentPageSize(page) {
  return page.evaluate(() => {
    const body = document.body?.innerText || "";
    const show = body.match(/Show:\s*(\d+)\s*Vehicles?/i);
    if (show) return Number(show[1]);
    const range = body.match(/VEHICLES\s+\d+\s*-\s*(\d+)\s+OF\s+(\d+)/i);
    if (range) return Number(range[1]);
    return null;
  });
}

async function waitForVehicleDataLoaded(page, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await countVehicleRows(page);
    const hasRange = await page.evaluate(() =>
      /VEHICLES\s+\d+\s*-\s*\d+\s+OF\s+\d+/i.test(document.body?.innerText || "")
    );
    if (count >= 10 || hasRange) return count;
    await sleep(1000);
  }
  return countVehicleRows(page);
}

async function countVehicleRows(page) {
  const rows = await scanVehicleRows(page);
  return rows.length;
}

async function openPageSizeMenu(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(800);

  const opened = await page.evaluate(() => {
    for (const el of document.querySelectorAll(
      "a, button, span, div, li, label, [role='button'], [role='menuitem']"
    )) {
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!/^show:\s*\d+\s*vehicles?$/i.test(text)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return text;
    }
    return null;
  });

  if (opened) {
    console.log(`[wake] Opened page size menu (${opened})`);
    await sleep(600);
    return true;
  }

  const trigger = page
    .locator("a, button, span, div, li")
    .filter({ hasText: /Show:\s*\d+\s*Vehicle/i })
    .first();
  if (await trigger.isVisible().catch(() => false)) {
    await clickStable(trigger);
    console.log("[wake] Opened page size menu via locator");
    await sleep(600);
    return true;
  }
  return false;
}

async function pickPageSizeOption(page, pageSize) {
  const targetRe = new RegExp(`^show:\\s*${pageSize}\\s*vehicles?$`, "i");
  const picked = await page.evaluate((size) => {
    const want = new RegExp(`^show:\\s*${size}\\s*vehicles?$`, "i");
    for (const el of document.querySelectorAll(
      "a, button, span, div, li, [role='menuitem'], [role='option'], .dropdown-item, .menu-item"
    )) {
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!want.test(text)) continue;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return text;
    }
    return null;
  }, pageSize);

  if (picked) {
    console.log(`[wake] Selected ${picked}`);
    return true;
  }

  const option = page
    .locator("a, button, span, div, li, [role='menuitem']")
    .filter({ hasText: targetRe })
    .first();
  await option.waitFor({ state: "visible", timeout: 15000 });
  await clickStable(option);
  console.log(`[wake] Selected Show: ${pageSize} Vehicles via locator`);
  return true;
}

async function forceReloadVehicleTable(page, pageSize = 100) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`[wake] Reloading vehicle table (attempt ${attempt}/3)…`);
    if (!(await openPageSizeMenu(page))) {
      await sleep(2000);
      continue;
    }
    await pickPageSizeOption(page, pageSize);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await sleep(2000 + attempt * 1000);
    const count = await waitForVehicleDataLoaded(page, 60000);
    if (count >= 10) {
      console.log(`[wake] Vehicle table loaded — ${count} rows visible`);
      return count;
    }
    console.log(`[wake] Table still empty (${count} rows) after attempt ${attempt}`);
  }
  throw new Error(`Vehicle table did not load (url=${page.url()})`);
}

/**
 * Open the bottom-left "Show: N Vehicles" menu and pick 100 per page.
 */
export async function setVehiclesPageSize(page, pageSize = 100) {
  await waitForVehiclesList(page, 60000);

  const current = await readCurrentPageSize(page);
  const loaded = await countVehicleRows(page);

  if (current === pageSize && loaded >= 10) {
    console.log(`[wake] Already showing ${pageSize} vehicles per page (${loaded} rows visible)`);
    return;
  }

  const count = await forceReloadVehicleTable(page, pageSize);
  const after = await readCurrentPageSize(page);
  if (after !== pageSize) {
    console.log(
      `[wake] Warning: requested ${pageSize}/page but page reports ${after ?? "unknown"} — continuing`
    );
  } else {
    console.log(`[wake] Page size set to ${pageSize} vehicles (${count} rows visible)`);
  }
}

export async function readPagination(page) {
  return page.evaluate(() => {
    const body = document.body?.innerText || "";

    const pageMatches = [...body.matchAll(/\b(\d+)\s+of\s+(\d+)\b/gi)];
    for (let i = pageMatches.length - 1; i >= 0; i -= 1) {
      const current = Number(pageMatches[i][1]);
      const total = Number(pageMatches[i][2]);
      if (total > 1 && total <= 50) return { current, total };
    }

    const range = body.match(/VEHICLES\s+(\d+)\s*-\s*(\d+)\s+OF\s+(\d+)/i);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const totalVehicles = Number(range[3]);
      const pageSize = Math.max(end - start + 1, 1);
      return {
        current: Math.floor((start - 1) / pageSize) + 1,
        total: Math.max(Math.ceil(totalVehicles / pageSize), 1),
      };
    }

    return { current: 1, total: 1 };
  });
}

async function scrollPaginationIntoView(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(600);
}

export async function goToNextPage(page) {
  await scrollPaginationIntoView(page);

  const viaDom = await page.evaluate(() => {
    const isDisabledControl = (el) => {
      if (!el) return true;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return true;
      if (el.classList?.contains("disabled")) return true;
      const style = window.getComputedStyle(el);
      return style.pointerEvents === "none" || style.visibility === "hidden";
    };

    const tryClick = (el) => {
      if (!el || isDisabledControl(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    };

    const controls = [
      ...document.querySelectorAll(
        "button, a, [role='button'], [role='link'], span, i, li, div"
      ),
    ];

    for (const el of controls) {
      const label = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${
        el.className || ""
      }`.toLowerCase();
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (label.includes("next page") || label === "next" || /^next$/i.test(text)) {
        if (tryClick(el)) return "label-next";
      }
      if (text === ">" || text === "›" || text === "»") {
        if (tryClick(el)) return "chevron-next";
      }
    }

    const pagers = document.querySelectorAll(
      "[class*='pag'], [class*='Pager'], .pagination, [class*='pagination']"
    );
    for (const pager of pagers) {
      const btns = pager.querySelectorAll("button, a, [role='button'], span, i");
      for (const btn of btns) {
        const cls = (btn.className || "").toLowerCase();
        const text = (btn.innerText || btn.textContent || "").trim();
        if (cls.includes("next") || cls.includes("right") || text === ">" || text === "›") {
          if (tryClick(btn)) return "pager-next";
        }
      }
    }

    return null;
  });

  if (viaDom) {
    console.log(`[wake] Advanced to next page (${viaDom})`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(2500);
    return true;
  }

  const next = page
    .locator("button, a, [role='button']")
    .filter({ hasText: /^>$/ })
    .or(page.locator("button[aria-label*='next' i], a[aria-label*='next' i]"))
    .last();
  if (!(await next.isVisible().catch(() => false))) {
    console.log("[wake] Could not find next-page control");
    return false;
  }
  if (await next.isDisabled().catch(() => false)) return false;
  await clickStable(next);
  await sleep(1500);
  return true;
}

export async function goToFirstPage(page) {
  await scrollPaginationIntoView(page);

  const jumped = await page.evaluate(() => {
    const isDisabledControl = (el) => {
      if (!el) return true;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return true;
      if (el.classList?.contains("disabled")) return true;
      const style = window.getComputedStyle(el);
      return style.pointerEvents === "none" || style.visibility === "hidden";
    };

    const tryClick = (el) => {
      if (!el || isDisabledControl(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    };

    for (const el of document.querySelectorAll("button, a, [role='button'], span, i")) {
      const label = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`.toLowerCase();
      const text = (el.innerText || el.textContent || "").trim();
      if (label.includes("first page") || text === "«" || text === "|«") {
        if (tryClick(el)) return "first";
      }
      if (/^1$/.test(text)) {
        const pager = el.closest("[class*='pag'], [class*='Pager'], .pagination");
        if (pager && tryClick(el)) return "page-1";
      }
    }
    return null;
  });

  if (jumped) {
    await sleep(1200);
    return;
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const viaDom = await page.evaluate(() => {
      const isDisabledControl = (el) => {
        if (!el) return true;
        if (el.disabled || el.getAttribute("aria-disabled") === "true") return true;
        if (el.classList?.contains("disabled")) return true;
        const style = window.getComputedStyle(el);
        return style.pointerEvents === "none" || style.visibility === "hidden";
      };

      const tryClick = (el) => {
        if (!el || isDisabledControl(el)) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return false;
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      };

      for (const el of document.querySelectorAll("button, a, [role='button'], span, i")) {
        const label = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`.toLowerCase();
        const text = (el.innerText || el.textContent || "").trim();
        if (label.includes("first") || label.includes("previous page") || text === "«" || text === "‹") {
          if (tryClick(el)) return true;
        }
        if (text === "<") {
          const pagers = el.closest("[class*='pag'], [class*='Pager'], .pagination");
          if (pagers && tryClick(el)) return true;
        }
      }
      return false;
    });

    if (!viaDom) break;
    await sleep(800);
  }
}

export async function refreshVehiclesList(page, appConfig = {}, wakeConfig = {}, pageSize = 100) {
  console.log("[wake] Refreshing vehicles table between passes…");
  await goToFirstPage(page);
  await sleep(1500);
  const rows = await forceReloadVehicleTable(page, pageSize);
  console.log(`[wake] Refresh complete — ${rows} rows on page 1`);
}

async function primeVehicleTable(page) {
  await page.evaluate(() => {
    const scrollables = [
      ...document.querySelectorAll("table tbody, [role='rowgroup'], [class*='scroll'], [class*='table']"),
    ];
    for (const el of scrollables) {
      if (el.scrollHeight > el.clientHeight + 4) {
        el.scrollTop = 0;
        el.scrollTop = el.scrollHeight;
        el.scrollTop = 0;
      }
    }
    window.scrollTo(0, 0);
  });
  await sleep(400);
}

export async function scanVehicleRows(page) {
  await primeVehicleTable(page);

  return page.evaluate(() => {
    const compact = (value) => String(value || "").replace(/\s+/g, "").toUpperCase();
    const isDeviceId = (id) => /^(MV|QM)\d/i.test(id || "");
    const compactVehicleRe = /\b([A-Z]{1,3}\d{3,5}[A-Z]{0,3})\b/;
    const spacedVehicleRe = /\b([A-Z]{1,3}\s+\d{2,5}\s+[A-Z]{1,3})\b/;
    const deviceRe = /\b((?:MV|QM)\d{4,})\b/i;
    const dateRe =
      /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}(?:,\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))?)|(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}(?:,\s*\d{1,2}:\d{2}(?::\d{2})?)?)/i;
    const blankDateRe = /^[\u2014\u2013—–\-]+$|^n\/?a$/i;

    const cellText = (el) => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();

    const extractVehicleId = (cells, text) => {
      const first = cells[0] || "";
      if (first && !isDeviceId(compact(first))) {
        const spaced = first.match(spacedVehicleRe);
        if (spaced) return compact(spaced[1]);
        const compactMatch = first.match(compactVehicleRe);
        if (compactMatch && !isDeviceId(compactMatch[1])) return compactMatch[1].toUpperCase();
      }
      const spaced = text.match(spacedVehicleRe);
      if (spaced && !isDeviceId(compact(spaced[1]))) return compact(spaced[1]);
      for (const match of text.matchAll(new RegExp(compactVehicleRe.source, "g"))) {
        if (!isDeviceId(match[1])) return match[1].toUpperCase();
      }
      return "";
    };

    const extractDevice = (cells, text) => {
      for (const cell of cells) {
        if (/^(MV|QM)\d{4,}$/i.test(cell)) return cell.toUpperCase();
      }
      const match = text.match(deviceRe);
      return match ? match[1].toUpperCase() : "";
    };

    const extractLastCommunicated = (cellEls, cells, text) => {
      const classHit = cellEls.find((el) => {
        const cls = `${el.className || ""} ${el.getAttribute("data-column") || ""}`.toLowerCase();
        return cls.includes("lastcommunicat") || cls.includes("last-communicat");
      });
      if (classHit) {
        const value = cellText(classHit);
        if (!value || blankDateRe.test(value)) return "";
        return value;
      }
      for (const cell of cells) {
        const dateMatch = cell.match(dateRe);
        if (dateMatch) return dateMatch[0];
      }
      if (cells.length >= 3 && (!cells[2] || blankDateRe.test(cells[2]))) return "";
      const fromText = text.match(dateRe);
      return fromText ? fromText[0] : "";
    };

    const classify = (text, actionLabels) => {
      for (const label of actionLabels) {
        if (/could not wake|retry\??/i.test(label)) return "retry";
        if (/waking\s*up/i.test(label)) return "waking";
        if (/^wake$/i.test(label)) return "wake";
        if (/not available/i.test(label)) return "not_available";
        if (/^browse$/i.test(label)) return "browse";
      }
      if (/Could not wake|Retry\??/i.test(text)) return "retry";
      if (/Waking\s*Up/i.test(text)) return "waking";
      if (/\bWake\b/i.test(text)) return "wake";
      if (/Not available/i.test(text)) return "not_available";
      if (/\bBrowse\b/i.test(text)) return "browse";
      return "other";
    };

    const rows = [];
    const candidates = [
      ...document.querySelectorAll("table tbody tr"),
      ...document.querySelectorAll("[role='row']"),
    ];

    const seen = new Set();
    for (const tr of candidates) {
      const text = (tr.innerText || tr.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length < 8) continue;
      if (/^vehicles?\b/i.test(text) && !compactVehicleRe.test(text) && !spacedVehicleRe.test(text)) {
        continue;
      }

      const cellEls = [...tr.querySelectorAll("td, [role='cell'], [role='gridcell']")];
      const cells = cellEls.map(cellText);

      const vehicleId = extractVehicleId(cells, text);
      if (!vehicleId) continue;
      if (seen.has(vehicleId)) continue;
      seen.add(vehicleId);

      const actionLabels = [...tr.querySelectorAll("a, button, [role='button'], [role='link']")]
        .map((el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);

      const status = classify(text, actionLabels);
      rows.push({
        vehicleId,
        status,
        text,
        device: extractDevice(cells, text),
        lastCommunicated: extractLastCommunicated(cellEls, cells, text),
      });
    }
    return rows;
  });
}

export function shouldClickWake(row) {
  return row.status === "wake" || row.status === "retry";
}

export async function clickWakeOrRetryForVehicle(page, vehicleId) {
  const viaDom = await page.evaluate((id) => {
    const vehicleRe = new RegExp(`\\b${id}\\b`);
    const rows = [
      ...document.querySelectorAll("table tbody tr"),
      ...document.querySelectorAll("[role='row']"),
    ];

    const tryClick = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    };

    for (const tr of rows) {
      const text = (tr.innerText || tr.textContent || "").replace(/\s+/g, " ").trim();
      if (!vehicleRe.test(text)) continue;

      const controls = tr.querySelectorAll("a, button, [role='button'], [role='link'], span, div");
      for (const el of controls) {
        const label = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (/^wake$/i.test(label) && tryClick(el)) return "wake";
      }
      for (const el of controls) {
        const label = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (/retry/i.test(label) && tryClick(el)) return "retry";
      }

      // Whole-cell click if Wake/Retry text is in the row but not a discrete button.
      if (/\bWake\b/i.test(text) && !/\bBrowse\b/i.test(text)) {
        for (const el of controls) {
          const label = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          if (/wake/i.test(label) && tryClick(el)) return "wake";
        }
      }
      if (/Retry/i.test(text) || /Could not wake/i.test(text)) {
        for (const el of controls) {
          const label = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          if (/retry/i.test(label) && tryClick(el)) return "retry";
        }
      }
    }
    return false;
  }, vehicleId);

  if (viaDom) return viaDom;

  const row = page.locator("tr, [role='row']").filter({ hasText: vehicleId }).first();
  if (!(await row.count())) return false;

  const wakeLink = row
    .locator("a, button, [role='button'], [role='link']")
    .filter({ hasText: /Wake/i })
    .first();
  if (await wakeLink.isVisible().catch(() => false)) {
    await clickStable(wakeLink);
    return "wake";
  }

  const retryLink = row
    .locator("a, button, [role='button'], [role='link']")
    .filter({ hasText: /Retry/i })
    .first();
  if (await retryLink.isVisible().catch(() => false)) {
    await clickStable(retryLink);
    return "retry";
  }

  return false;
}

async function waitForVehicleRows(page, minRows = 1, timeoutMs = 60000) {
  const count = await waitForVehicleDataLoaded(page, timeoutMs);
  if (count < minRows) {
    const snippet = await page
      .evaluate(() => (document.body?.innerText || "").slice(0, 400))
      .catch(() => "");
    console.log(
      `[wake] Warning: only ${count} vehicle row(s) after ${timeoutMs / 1000}s (url=${page.url()}). Snippet: ${snippet.replace(/\s+/g, " ").slice(0, 160)}`
    );
  }
  return count;
}

export async function runWakePass(page, { clickDelayMs = 1000, passNumber = 1 } = {}) {
  await goToFirstPage(page);
  await sleep(500);
  const rowCount = await waitForVehicleDataLoaded(page, 90000);
  if (rowCount < 20) {
    throw new Error(
      `Pass ${passNumber} cannot run — only ${rowCount} vehicle rows visible (table not loaded)`
    );
  }

  let clicked = 0;
  let pages = 0;
  const clickedVehicles = [];
  const notAvailableVehicles = new Map();
  const pageResults = [];
  const warnings = [];
  const { total } = await readPagination(page);
  const maxPages = Math.max(total, 1);

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    pages += 1;
    const rows = await scanVehicleRows(page);
    for (const row of rows) {
      if (row.status === "not_available") {
        notAvailableVehicles.set(
          row.vehicleId,
          row.device || notAvailableVehicles.get(row.vehicleId) || ""
        );
      }
    }
    const targets = rows.filter(shouldClickWake);
    let pageClicked = 0;
    const pageClickedIds = [];

    console.log(
      `[wake] Page ${pageNum}/${maxPages}: ${targets.length} Wake/Retry of ${rows.length} rows`
    );

    for (const row of targets) {
      const action = await clickWakeOrRetryForVehicle(page, row.vehicleId);
      if (action) {
        clicked += 1;
        pageClicked += 1;
        clickedVehicles.push(row.vehicleId);
        pageClickedIds.push(row.vehicleId);
        console.log(`[wake] Clicked ${action} on ${row.vehicleId}`);
        await sleep(clickDelayMs);
      } else {
        console.log(`[wake] Could not click Wake/Retry on ${row.vehicleId}`);
      }
    }

    let pageWarning = null;
    if (pageNum >= maxPages && rows.length < 5) {
      pageWarning = `Page ${pageNum} only had ${rows.length} rows — last page may be incomplete`;
      warnings.push(pageWarning);
    }

    pageResults.push({
      pageNum,
      maxPages,
      rows: rows.length,
      targets: targets.length,
      clicked: pageClicked,
      clickedIds: pageClickedIds,
      warning: pageWarning,
    });

    if (pageNum >= maxPages) break;
    const moved = await goToNextPage(page);
    if (!moved) {
      const msg = `Stopped at page ${pageNum}/${maxPages} — next-page control not found`;
      console.log(`[wake] ${msg}`);
      warnings.push(msg);
      break;
    }
    const afterPageRows = await waitForVehicleDataLoaded(page, 30000);
    if (afterPageRows < 5) {
      const msg = `Page ${pageNum + 1} only has ${afterPageRows} rows after paging — table may be stale`;
      console.log(`[wake] Warning: ${msg}`);
      warnings.push(msg);
    }
  }

  return {
    clicked,
    pages,
    maxPages,
    pageResults,
    clickedVehicles,
    notAvailableVehicles: [...notAvailableVehicles.entries()].map(([vehicleId, device]) => ({
      vehicleId,
      device,
    })),
    warnings,
  };
}

export async function collectNotBrowseTrucks(page) {
  await goToFirstPage(page);
  await sleep(500);
  const rowCount = await waitForVehicleDataLoaded(page, 90000);
  if (rowCount < 20) {
    throw new Error(`Final scan cannot run — only ${rowCount} vehicle rows visible (table not loaded)`);
  }

  const out = [];
  const seen = new Set();
  const { total } = await readPagination(page);
  const maxPages = Math.max(total, 1);
  const statusCounts = {};

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const rows = await scanVehicleRows(page);
    let pageHits = 0;
    for (const row of rows) {
      statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
      if (row.status === "browse" || seen.has(row.vehicleId)) continue;
      pageHits += 1;
      seen.add(row.vehicleId);
      out.push({
        vehicleId: row.vehicleId,
        status: row.status,
        detail: summarizeStatus(row.text, row.status),
      });
    }
    console.log(
      `[wake] Final scan page ${pageNum}/${maxPages}: ${rows.length} rows, ${pageHits} not Browse`
    );

    if (rows.length < 20 && pageNum === 1) {
      console.log(
        `[wake] Warning: only ${rows.length} rows on page 1 — table may be stale; results may be incomplete`
      );
    }

    if (pageNum >= maxPages) break;
    const moved = await goToNextPage(page);
    if (!moved) {
      console.log(`[wake] Stopped at page ${pageNum}/${maxPages} — next-page control not found`);
      break;
    }
    await waitForVehicleRows(page, 1, 15000);
  }

  console.log(`[wake] Final scan status counts: ${JSON.stringify(statusCounts)}`);
  return out.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
}

/**
 * Walk every Vehicles page and collect trucks whose Last communicated date
 * is older than maxAgeDays (or missing). Does not click Wake/Retry.
 */
export async function scanStaleCameraPages(page, { maxAgeDays = 2, now = new Date() } = {}) {
  await goToFirstPage(page);
  await sleep(500);
  const rowCount = await waitForVehicleDataLoaded(page, 90000);
  if (rowCount < 1) {
    throw new Error(
      `Stale camera scan cannot run — no vehicle rows visible (table not loaded). URL: ${page.url()}`
    );
  }
  if (rowCount < 20) {
    console.log(
      `[stale-cameras] Warning: only ${rowCount} vehicle rows visible — proceeding anyway`
    );
  }

  const stale = [];
  const seen = new Set();
  const pageResults = [];
  const warnings = [];
  const { total } = await readPagination(page);
  const maxPages = Math.max(total, 1);
  let scanned = 0;
  let skippedRecent = 0;
  let skippedUnparsed = 0;
  let notAvailableCount = 0;
  let staleDateCount = 0;

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const rows = await scanVehicleRows(page);
    let pageNotAvailable = 0;
    let pageStaleDate = 0;
    for (const row of rows) {
      if (seen.has(row.vehicleId)) continue;
      seen.add(row.vehicleId);
      scanned += 1;
      const verdict = classifyCameraScanRow(row, { maxAgeDays, now });
      if (!verdict.include) {
        if (verdict.dateReason === "unparsed") {
          skippedUnparsed += 1;
          console.log(
            `[stale-cameras] Skip ${row.vehicleId} — could not parse last communicated (${row.lastCommunicated || "empty"})`
          );
        } else {
          skippedRecent += 1;
        }
        continue;
      }
      if (verdict.mark === "not_available") {
        pageNotAvailable += 1;
        notAvailableCount += 1;
      } else {
        pageStaleDate += 1;
        staleDateCount += 1;
      }
      stale.push({
        vehicleId: row.vehicleId,
        device: row.device || parseDeviceNumber(row.text) || "",
        lastCommunicated: row.lastCommunicated || "",
        mark: verdict.mark,
        reason: verdict.mark,
        dateReason: verdict.dateReason,
        status: row.status,
      });
    }
    console.log(
      `[stale-cameras] Page ${pageNum}/${maxPages}: ${rows.length} rows, ${pageNotAvailable} not available, ${pageStaleDate} old dates`
    );
    pageResults.push({
      pageNum,
      maxPages,
      rows: rows.length,
      notAvailable: pageNotAvailable,
      staleDate: pageStaleDate,
      stale: pageNotAvailable + pageStaleDate,
    });

    if (pageNum >= maxPages) break;
    const moved = await goToNextPage(page);
    if (!moved) {
      const msg = `Stopped at page ${pageNum}/${maxPages} — next-page control not found`;
      console.log(`[stale-cameras] ${msg}`);
      warnings.push(msg);
      break;
    }
    await waitForVehicleRows(page, 1, 15000);
  }

  stale.sort((a, b) => {
    if (a.mark !== b.mark) return a.mark === "not_available" ? -1 : 1;
    return a.vehicleId.localeCompare(b.vehicleId);
  });
  return {
    stale,
    scanned,
    skippedRecent,
    skippedUnparsed,
    notAvailableCount,
    staleDateCount,
    pages: pageResults.length,
    maxPages,
    pageResults,
    warnings,
  };
}

function summarizeStatus(text, status) {
  if (status === "retry") return "Could not wake, Retry?";
  if (status === "waking") return "Waking Up";
  if (status === "wake") return "Wake";
  if (status === "not_available") return "Not available, No Recent Activity";
  if (/Not available/i.test(text)) return "Not available, No Recent Activity";
  if (/Waking\s*Up/i.test(text)) return "Waking Up";
  if (/Retry/i.test(text) || /Could not wake/i.test(text)) return "Could not wake, Retry?";
  if (/\bWake\b/i.test(text)) return "Wake";
  return text.slice(0, 80);
}

async function clickStable(locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await locator.click({ timeout: 8000 });
  } catch {
    await locator.click({ force: true, timeout: 12000 });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
