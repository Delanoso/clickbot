/**
 * Lytx Video Search → Vehicles → Wake / Retry automation.
 */

const VEHICLE_LIST_URLS = [
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
    const hasTable =
      /\bBrowse\b/i.test(body) ||
      /\bWake\b/i.test(body) ||
      /Show:\s*\d+\s*Vehicle/i.test(body) ||
      /VEHICLES\s+\d+\s*-\s*\d+\s+OF\s+\d+/i.test(body);
    return hasHeader && hasTable;
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

/**
 * Open the bottom-left "Show: N Vehicles" menu and pick 100 per page.
 */
export async function setVehiclesPageSize(page, pageSize = 100) {
  await waitForVehiclesList(page, 30000);

  const current = await readCurrentPageSize(page);
  if (current === pageSize) {
    console.log(`[wake] Already showing ${pageSize} vehicles per page`);
    return;
  }

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1000);

  const opened = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll("a, button, span, div, li, label, [role='button'], [role='menuitem']"),
    ];
    for (const el of candidates) {
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
  } else {
    const trigger = page
      .locator("a, button, span, div, li")
      .filter({ hasText: /Show:\s*\d+\s*Vehicle/i })
      .first();
    await trigger.waitFor({ state: "visible", timeout: 20000 });
    await clickStable(trigger);
    console.log("[wake] Opened page size menu via locator");
    await sleep(600);
  }

  const targetRe = new RegExp(`^show:\\s*${pageSize}\\s*vehicles?$`, "i");
  const picked = await page.evaluate((size) => {
    const want = new RegExp(`^show:\\s*${size}\\s*vehicles?$`, "i");
    const items = [
      ...document.querySelectorAll(
        "a, button, span, div, li, [role='menuitem'], [role='option'], .dropdown-item, .menu-item"
      ),
    ];
    for (const el of items) {
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!want.test(text)) continue;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return text;
    }
    return null;
  }, pageSize);

  if (!picked) {
    const option = page
      .locator("a, button, span, div, li, [role='menuitem']")
      .filter({ hasText: targetRe })
      .first();
    await option.waitFor({ state: "visible", timeout: 15000 });
    await clickStable(option);
    console.log(`[wake] Selected Show: ${pageSize} Vehicles via locator`);
  } else {
    console.log(`[wake] Selected ${picked}`);
  }

  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await sleep(2500);

  const after = await readCurrentPageSize(page);
  if (after !== pageSize) {
    console.log(
      `[wake] Warning: requested ${pageSize}/page but page reports ${after ?? "unknown"} — continuing`
    );
  } else {
    console.log(`[wake] Page size set to ${pageSize} vehicles`);
  }
}

export async function readPagination(page) {
  return page.evaluate(() => {
    const body = document.body?.innerText || "";
    const m = body.match(/(\d+)\s+of\s+(\d+)/i);
    if (!m) return { current: 1, total: 1 };
    return { current: Number(m[1]), total: Number(m[2]) };
  });
}

export async function goToNextPage(page) {
  const next = page
    .locator("button, a, [role='button']")
    .filter({ hasText: /^>$/ })
    .or(page.locator("button[aria-label*='next' i], a[aria-label*='next' i]"))
    .last();
  if (!(await next.isVisible().catch(() => false))) return false;
  const disabled = await next.isDisabled().catch(() => false);
  if (disabled) return false;
  await clickStable(next);
  await sleep(1500);
  return true;
}

export async function goToFirstPage(page) {
  for (let i = 0; i < 50; i += 1) {
    const prev = page
      .locator("button, a, [role='button']")
      .filter({ hasText: /^<$/ })
      .or(page.locator("button[aria-label*='prev' i], a[aria-label*='prev' i]"))
      .first();
    if (!(await prev.isVisible().catch(() => false))) break;
    if (await prev.isDisabled().catch(() => false)) break;
    await clickStable(prev);
    await sleep(800);
  }
}

export async function scanVehicleRows(page) {
  return page.evaluate(() => {
    const vehicleRe = /\b([A-Z]{1,3}\d{3,5}[A-Z]{0,3})\b/;
    const rows = [];

    const candidates = [
      ...document.querySelectorAll("table tbody tr"),
      ...document.querySelectorAll("[role='row']"),
    ];

    const seen = new Set();
    for (const tr of candidates) {
      const text = (tr.innerText || tr.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length < 8) continue;

      const idMatch = text.match(vehicleRe);
      if (!idMatch) continue;
      const vehicleId = idMatch[1];
      if (seen.has(vehicleId)) continue;
      seen.add(vehicleId);

      let status = "other";
      if (/\bBrowse\b/i.test(text)) status = "browse";
      else if (/Waking\s*Up/i.test(text)) status = "waking";
      else if (/Retry/i.test(text) || /Could not wake/i.test(text)) status = "retry";
      else if (/\bWake\b/i.test(text)) status = "wake";
      else if (/Not available/i.test(text)) status = "not_available";

      rows.push({ vehicleId, status, text });
    }
    return rows;
  });
}

export function shouldClickWake(row) {
  return row.status === "wake" || row.status === "retry";
}

export async function clickWakeOrRetryForVehicle(page, vehicleId) {
  const row = page.locator("tr, [role='row']").filter({ hasText: vehicleId }).first();
  if (!(await row.count())) return false;

  const wakeLink = row
    .locator("a, button, [role='button'], [role='link']")
    .filter({ hasText: /^Wake$/i })
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

export async function runWakePass(page, { clickDelayMs = 1000, passNumber = 1 } = {}) {
  await goToFirstPage(page);
  await sleep(500);

  let clicked = 0;
  let pages = 0;
  const { total } = await readPagination(page);
  const maxPages = Math.max(total, 1);

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    pages += 1;
    const rows = await scanVehicleRows(page);
    const targets = rows.filter(shouldClickWake);
    console.log(
      `[wake] Pass ${passNumber} page ${pageNum}/${maxPages}: ${targets.length} Wake/Retry of ${rows.length} rows`
    );

    for (const row of targets) {
      const action = await clickWakeOrRetryForVehicle(page, row.vehicleId);
      if (action) {
        clicked += 1;
        console.log(`[wake] Clicked ${action} on ${row.vehicleId}`);
        await sleep(clickDelayMs);
      }
    }

    if (pageNum >= maxPages) break;
    const moved = await goToNextPage(page);
    if (!moved) break;
  }

  return { clicked, pages };
}

export async function collectNotBrowseTrucks(page) {
  await goToFirstPage(page);
  await sleep(500);

  const out = [];
  const seen = new Set();
  const { total } = await readPagination(page);
  const maxPages = Math.max(total, 1);

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const rows = await scanVehicleRows(page);
    for (const row of rows) {
      if (row.status === "browse" || seen.has(row.vehicleId)) continue;
      seen.add(row.vehicleId);
      out.push({
        vehicleId: row.vehicleId,
        status: row.status,
        detail: summarizeStatus(row.text),
      });
    }
    if (pageNum >= maxPages) break;
    const moved = await goToNextPage(page);
    if (!moved) break;
  }

  return out.sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
}

function summarizeStatus(text) {
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
