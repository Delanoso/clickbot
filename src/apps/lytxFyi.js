import { clickFrom, locate } from "../locate.js";

/**
 * Open FYI Notify from the Driver Safety dashboard tile.
 */
export async function ensureFyiNotifyPage(page, appConfig = {}) {
  const selectors = appConfig.fyi?.selectors || appConfig.selectors?.fyi || {};
  const tile = selectors.openTile || { text: "FYI NOTIFY" };

  // Already on FYI notify list?
  if (/fyi/i.test(page.url()) || (await page.getByText("FYI NOTIFY", { exact: true }).count())) {
    const preview = page.getByRole("button", { name: /Preview/i }).first();
    if (await preview.isVisible().catch(() => false)) {
      return;
    }
  }

  // Prefer dashboard tile click (same pattern as Assign Drivers).
  try {
    await locate(page, tile).waitFor({ state: "visible", timeout: 20000 });
    await clickFrom(page, tile);
  } catch {
    // Fall back to sidebar / hash if tile not visible.
    const sidebar = page.getByText(/^Fyi Notify$/i).first();
    if (await sidebar.isVisible().catch(() => false)) {
      await sidebar.click();
    } else if (appConfig.fyi?.workUrl || appConfig.workUrl) {
      await page.goto(appConfig.fyi?.workUrl || appConfig.workUrl, {
        waitUntil: "domcontentloaded",
      });
    }
  }

  await page.getByText(/FYI NOTIFY/i).first().waitFor({ state: "visible", timeout: 60000 });
  await sleep(1500);
}

/**
 * True when at least one Preview button is still available.
 */
export async function hasFyiPreview(page) {
  const preview = page.getByRole("button", { name: /Preview/i }).first();
  return preview.isVisible().catch(() => false);
}

/**
 * Resolve one FYI Notify card:
 * Preview → wait for detail → Resolve → Yes, Confirm
 */
export async function resolveOneFyiNotify(page, selectors = {}) {
  const preview = page.getByRole("button", { name: /Preview/i }).first();
  await preview.waitFor({ state: "visible", timeout: 30000 });
  await clickStable(preview);

  // Detail view / modal with Resolve
  const resolveBtn = page.getByRole("button", { name: /^Resolve$/i }).first();
  await resolveBtn.waitFor({ state: "visible", timeout: 60000 });
  await resolveBtn.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(400);
  await clickStable(resolveBtn);

  // Confirmation: "Are you sure..." → Yes, Confirm
  // Prefer the known modal primary button id (avoids animation/stability flakes).
  const confirm = page
    .locator("#modalShellPrimaryButton")
    .or(page.getByRole("button", { name: /Yes,\s*Confirm/i }))
    .first();
  await confirm.waitFor({ state: "visible", timeout: 30000 });
  await sleep(300);
  await clickStable(confirm, { forceAfterMs: 1500 });

  // Wait for confirm modal / detail to close and list to return.
  await confirm.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await resolveBtn.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await sleep(1000);

  // Ensure we're back on a list with cards (or empty).
  await page.getByText(/FYI NOTIFY/i).first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
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

  // Animation / overlay flake — force the click.
  await locator.click({ force: true, timeout: 10000 });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
