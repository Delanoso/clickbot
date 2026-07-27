/**
 * Lytx Video Search → Vehicles → Wake / Retry automation.
 */

export async function ensureVehiclesListPage(page, appConfig = {}, wakeConfig = {}) {
  const workUrl = wakeConfig.workUrl || appConfig.workUrl || "https://app.lytx.com/";
  if (!/app\.lytx\.com/i.test(page.url())) {
    await page.goto(workUrl, { waitUntil: "domcontentloaded" });
    await sleep(1500);
  }

  // Top nav: Video Search
  const videoSearch = page.getByRole("link", { name: /Video Search/i }).or(
    page.getByText(/^Video Search$/i)
  );
  if (await videoSearch.first().isVisible().catch(() => false)) {
    await clickStable(videoSearch.first());
    await sleep(1200);
  }

  // Left sidebar: Vehicles (truck icon area — often labeled Vehicles)
  const vehiclesNav = page
    .locator("a, button, [role='button'], [role='link']")
    .filter({ hasText: /^Vehicles$/i });
  if (await vehiclesNav.first().isVisible().catch(() => false)) {
    await clickStable(vehiclesNav.first());
  } else {
    // Icon-only nav: second item under Video Search is often Vehicles.
    const sidebarLinks = page.locator("nav a, .sidebar a, [class*='sidebar'] a");
    const count = await sidebarLinks.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 8); i += 1) {
      const link = sidebarLinks.nth(i);
      const label = ((await link.getAttribute("title").catch(() => "")) || "").toLowerCase();
      const aria = ((await link.getAttribute("aria-label").catch(() => "")) || "").toLowerCase();
      if (label.includes("vehicle") || aria.includes("vehicle")) {
        await clickStable(link);
        break;
      }
    }
  }

  await page
    .getByText(/^VEHICLES$/i)
    .first()
    .waitFor({ state: "visible", timeout: 60000 })
    .catch(() => {});
  await sleep(800);
}

/**
 * Open the bottom-left "Show: N Vehicles" menu and pick 100 per page.
 * (411 trucks ≈ 5 pages at 100/page.)
 */
export async function setVehiclesPageSize(page, pageSize = 100) {
  const trigger = page
    .getByText(new RegExp(`Show:\\s*\\d+\\s*Vehicles?`, "i"))
    .first();
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await clickStable(trigger);
  await sleep(400);

  const option = page
    .getByText(new RegExp(`Show:\\s*${pageSize}\\s*Vehicles?`, "i"))
    .first();
  await option.waitFor({ state: "visible", timeout: 15000 });
  await clickStable(option);
  await sleep(2000);
  console.log(`[wake] Page size set to ${pageSize} vehicles`);
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

/**
 * Scan the vehicles table. Returns rows with vehicleId + status bucket.
 */
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
    await locator.click({ timeout: 5000 });
  } catch {
    await locator.click({ force: true, timeout: 8000 });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
