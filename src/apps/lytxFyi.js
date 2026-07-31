import { clickFrom, locate } from "../locate.js";

/**
 * Open FYI Notify from the Driver Safety dashboard tile.
 */
export async function ensureFyiNotifyPage(page, appConfig = {}) {
  const selectors = appConfig.fyi?.selectors || appConfig.selectors?.fyi || {};
  const tile = selectors.openTile || { text: "FYI NOTIFY" };
  const workUrl =
    appConfig.fyi?.workUrl ||
    "https://app.lytx.com/#/driver-safety/tasks/fyinotify";

  await dismissOverlays(page);

  // Already on FYI notify list with Preview cards?
  if (/fyinotify/i.test(page.url())) {
    await waitForListReady(page, { timeoutMs: 8000 }).catch(() => {});
    if (await hasFyiPreview(page)) {
      return;
    }
  }

  // Prefer dashboard tile click (same pattern as Assign Drivers).
  try {
    await locate(page, tile).waitFor({ state: "visible", timeout: 15000 });
    await clickFrom(page, tile);
  } catch {
    await dismissOverlays(page);
    const sidebar = page.getByText(/^Fyi Notify$/i).first();
    if (await sidebar.isVisible().catch(() => false)) {
      await sidebar.click({ force: true }).catch(async () => {
        await page.goto(workUrl, { waitUntil: "domcontentloaded" });
      });
    } else {
      await page.goto(workUrl, { waitUntil: "domcontentloaded" });
    }
  }

  await dismissOverlays(page);
  await page.getByText(/FYI NOTIFY/i).first().waitFor({ state: "visible", timeout: 60000 });
  await waitForListReady(page, { timeoutMs: 20000 }).catch(() => {});
  await sleep(800);
}

/**
 * True when at least one Preview button is still available.
 */
export async function hasFyiPreview(page) {
  await dismissOverlays(page);
  const preview = page.getByRole("button", { name: /Preview/i }).first();
  return preview.isVisible().catch(() => false);
}

/**
 * Remaining FYI count from the page header / pager ("125 Tasks", "1 - 20 of 125").
 * Returns null when unknown.
 */
export async function readFyiRemainingCount(page) {
  return page.evaluate(() => {
    const body = document.body?.innerText || "";
    const ofMatch = body.match(/\b\d+\s*[-–]\s*\d+\s+of\s+(\d+)\b/i);
    if (ofMatch) return Number(ofMatch[1]);

    const header = [...document.querySelectorAll("h1, h2, h3, span, div")].find(
      (el) => /^FYI NOTIFY$/i.test((el.textContent || "").trim())
    );
    if (header) {
      const block = (header.parentElement?.innerText || header.innerText || "")
        .replace(/\s+/g, " ")
        .trim();
      const m = block.match(/FYI NOTIFY\s+(\d+)/i);
      if (m) return Number(m[1]);
    }

    const side = [...document.querySelectorAll("a, li, span, div")].find((el) =>
      /^Fyi Notify$/i.test((el.textContent || "").trim())
    );
    if (side?.parentElement) {
      const m = (side.parentElement.innerText || "").match(/Fyi Notify\s+(\d+)/i);
      if (m) return Number(m[1]);
    }
    return null;
  });
}

/**
 * Wait until Preview cards appear, or remaining count is clearly 0.
 */
export async function waitForListReady(page, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await dismissOverlays(page);
    if (await hasFyiPreview(page)) return true;
    const remaining = await readFyiRemainingCount(page);
    if (remaining === 0) return false;
    await sleep(500);
  }
  return hasFyiPreview(page);
}

/**
 * If the current page has no Preview but items remain, reload / go to page 1.
 */
export async function recoverFyiList(page, appConfig = {}) {
  await dismissOverlays(page);
  if (await hasFyiPreview(page)) return true;

  const remaining = await readFyiRemainingCount(page);
  console.log(
    `[fyi] No Preview visible (remaining=${remaining ?? "?"}) — refreshing list.`
  );

  // Try pager "1" or first page control.
  const pageOne = page.getByRole("button", { name: /^1$/ }).first();
  if (await pageOne.isVisible().catch(() => false)) {
    await pageOne.click({ force: true }).catch(() => {});
    await sleep(1500);
    if (await waitForListReady(page, { timeoutMs: 10000 })) return true;
  }

  // Hard reload the FYI route.
  const workUrl =
    appConfig.fyi?.workUrl ||
    "https://app.lytx.com/#/driver-safety/tasks/fyinotify";
  await page.goto(workUrl, { waitUntil: "domcontentloaded" });
  await sleep(2000);
  await ensureFyiNotifyPage(page, appConfig);
  return waitForListReady(page, { timeoutMs: 20000 });
}

/**
 * Resolve one FYI Notify card:
 * Preview → wait for detail → Resolve → Yes, Confirm
 */
export async function resolveOneFyiNotify(page, selectors = {}) {
  await dismissOverlays(page);

  const preview = page.getByRole("button", { name: /Preview/i }).first();
  await preview.waitFor({ state: "visible", timeout: 30000 });
  await clickStable(preview);

  // Detail view / modal with Resolve
  const resolveBtn = page.getByRole("button", { name: /^Resolve$/i }).first();
  await resolveBtn.waitFor({ state: "visible", timeout: 60000 });
  await resolveBtn.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(400);
  await clickStable(resolveBtn, { forceAfterMs: 4000 });

  // Confirmation: "Are you sure..." → Yes, Confirm
  const confirm = page
    .locator("#modalShellPrimaryButton")
    .or(page.getByRole("button", { name: /Yes,\s*Confirm/i }))
    .first();
  await confirm.waitFor({ state: "visible", timeout: 30000 });
  await sleep(400);
  await clickStable(confirm, { forceAfterMs: 2000 });

  // Wait for confirm modal / detail to close and list to return.
  await confirm.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await resolveBtn.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await dismissOverlays(page);

  // List re-renders after resolve — wait for Preview cards or empty queue.
  await page.getByText(/FYI NOTIFY/i).first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  await waitForListReady(page, { timeoutMs: 12000 }).catch(() => {});
  await sleep(400);
}

/**
 * Close leftover confirm / action modals that block navigation.
 */
export async function dismissOverlays(page) {
  for (let i = 0; i < 3; i += 1) {
    const modal = page.locator("ngb-modal-window, .modal.show, [role='dialog']").first();
    if (!(await modal.isVisible().catch(() => false))) {
      break;
    }

    const confirm = page
      .locator("#modalShellPrimaryButton")
      .or(page.getByRole("button", { name: /Yes,\s*Confirm/i }))
      .first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click({ force: true }).catch(() => {});
      await sleep(600);
      continue;
    }

    const cancel = page.getByRole("button", { name: /Cancel|Close|No/i }).first();
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click({ force: true }).catch(() => {});
      await sleep(400);
      continue;
    }

    await page.keyboard.press("Escape").catch(() => {});
    await sleep(400);
  }
}

/**
 * Click with retries; fall back to force click when the button keeps animating
 * ("element is not stable").
 */
async function clickStable(locator, { forceAfterMs = 2500 } = {}) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await locator.click({ timeout: forceAfterMs });
    return;
  } catch (error) {
    const message = String(error?.message || error);
    if (!/not stable|Timeout|intercepts pointer/i.test(message)) {
      throw error;
    }
  }

  await locator.click({ force: true, timeout: 10000 });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
