import { clickFrom, locate } from "../locate.js";

/**
 * Lytx Due for Coaching helpers.
 * Dashboard tile → list → Coach Event(s) → play each clip ≥1s → Complete Session.
 */

export async function ensureDueForCoachingPage(page, appConfig = {}) {
  const coaching = appConfig.coaching || appConfig.dispatch?.coaching || {};
  const selectors = coaching.selectors || {};
  const tile = selectors.openTile || { text: "DUE FOR COACHING" };
  const workUrl =
    coaching.workUrl ||
    "https://app.lytx.com/#/driver-safety/tasks/dueforcoaching";

  await dismissOverlays(page);

  if (/dueforcoaching|due-for-coaching|coaching/i.test(page.url())) {
    if (await hasCoachButton(page)) return;
  }

  // Prefer dashboard home so the tile is clickable.
  try {
    await page.goto("https://app.lytx.com/#/driver-safety", {
      waitUntil: "domcontentloaded",
    });
    await sleep(1200);
  } catch {
    /* continue */
  }

  await dismissOverlays(page);

  try {
    await locate(page, tile).waitFor({ state: "visible", timeout: 20000 });
    await clickFrom(page, tile);
  } catch {
    await dismissOverlays(page);
    const textTile = page.getByText(/DUE FOR COACHING/i).first();
    if (await textTile.isVisible().catch(() => false)) {
      await textTile.click({ force: true }).catch(() => {});
    } else {
      await page.goto(workUrl, { waitUntil: "domcontentloaded" });
    }
  }

  await dismissOverlays(page);
  await page
    .getByText(/DUE FOR COACHING/i)
    .first()
    .waitFor({ state: "visible", timeout: 60000 })
    .catch(() => {});
  await waitForCoachListReady(page, { timeoutMs: 20000 }).catch(() => {});
  await sleep(600);
}

export async function hasCoachButton(page) {
  await dismissOverlays(page);
  const btn = coachButton(page).first();
  return btn.isVisible().catch(() => false);
}

function coachButton(page) {
  return page.getByRole("button", { name: /Coach(?:\s+\d+)?\s+Events?/i });
}

export async function readCoachingRemainingCount(page) {
  return page.evaluate(() => {
    const body = document.body?.innerText || "";
    const ofMatch = body.match(/\b\d+\s*[-–]\s*\d+\s+of\s+(\d+)\b/i);
    if (ofMatch) return Number(ofMatch[1]);

    const tasksMatch = body.match(/\b(\d+)\s+Tasks?\b/i);
    if (tasksMatch) return Number(tasksMatch[1]);

    const header = [...document.querySelectorAll("h1, h2, h3, span, div")].find(
      (el) => /^DUE FOR COACHING$/i.test((el.textContent || "").trim())
    );
    if (header) {
      const block = (header.parentElement?.innerText || header.innerText || "")
        .replace(/\s+/g, " ")
        .trim();
      const m = block.match(/DUE FOR COACHING\s+(\d+)/i);
      if (m) return Number(m[1]);
    }

    const tile = [...document.querySelectorAll("a, button, div, span")].find((el) =>
      /DUE FOR COACHING/i.test((el.textContent || "").trim())
    );
    if (tile) {
      const m = (tile.innerText || tile.textContent || "").match(/(\d+)/);
      if (m) return Number(m[1]);
    }
    return null;
  });
}

export async function waitForCoachListReady(page, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await dismissOverlays(page);
    if (await hasCoachButton(page)) return true;
    const remaining = await readCoachingRemainingCount(page);
    if (remaining === 0) return false;
    await sleep(500);
  }
  return hasCoachButton(page);
}

export async function recoverCoachList(page, appConfig = {}) {
  await dismissOverlays(page);
  if (await hasCoachButton(page)) return true;

  const remaining = await readCoachingRemainingCount(page);
  console.log(
    `[coaching] No Coach buttons visible (remaining=${remaining ?? "?"}) — refreshing list.`
  );

  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(1500);
  await ensureDueForCoachingPage(page, appConfig);
  return waitForCoachListReady(page, { timeoutMs: 20000 });
}

/**
 * Coach one Due-for-Coaching card end-to-end.
 */
export async function coachOneSession(page, selectors = {}) {
  await dismissOverlays(page);

  const openBtn = coachButton(page).first();
  await openBtn.waitFor({ state: "visible", timeout: 30000 });
  const label = ((await openBtn.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  await clickStable(openBtn);
  console.log(`[coaching] Opened session via "${label || "Coach Event"}"`);

  await page
    .getByText(/DRIVER COACHING SESSION|Event Videos|Complete Session/i)
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
  await sleep(1000);

  const played = await playAllEventVideos(page, selectors);
  console.log(`[coaching] Played ${played} event video(s)`);

  await waitForBehaviorsCleared(page, { timeoutMs: 20000 }).catch(() => {});

  await completeCoachingSession(page);
  await ensureDueForCoachingPage(page, { coaching: { selectors } }).catch(() => {});
  await waitForCoachListReady(page, { timeoutMs: 12000 }).catch(() => {});
  await sleep(500);

  return { played, label };
}

async function playAllEventVideos(page, selectors = {}) {
  const minPlayMs = Number(selectors.minPlayMs || 1100);
  let eventCount = await readEventVideoCount(page);

  // Single-event sessions often have no carousel — scroll to player and press play.
  if (!eventCount || eventCount <= 1) {
    await playCurrentVideo(page, { minPlayMs, forceScroll: true });
    return 1;
  }

  let played = 0;
  for (let i = 0; i < eventCount; i += 1) {
    await selectEventThumbnail(page, i, eventCount);
    await playCurrentVideo(page, { minPlayMs, forceScroll: i === 0 });
    played += 1;
  }
  return played;
}

async function readEventVideoCount(page) {
  const fromText = await page.evaluate(() => {
    const body = document.body?.innerText || "";
    const labeled = body.match(/Event Videos?\s*:\s*(\d+)/i);
    if (labeled) return Number(labeled[1]);
    const ofMatch = body.match(/EVENTS?\s+\d+\s*[-–]\s*\d+\s+OF\s+(\d+)/i);
    if (ofMatch) return Number(ofMatch[1]);
    return null;
  });
  if (fromText && fromText > 0) return fromText;

  const thumbs = await eventThumbnails(page);
  return thumbs;
}

async function eventThumbnails(page) {
  // Prefer carousel items that look like event IDs / viewed chips.
  const candidates = page.locator(
    [
      "[class*='carousel'] button",
      "[class*='Carousel'] button",
      "[class*='event'] img",
      "img[src*='event']",
      "button:has(img)",
    ].join(", ")
  );
  const count = await candidates.count().catch(() => 0);
  if (count > 0) return count;

  // Fallback: count green check / VIEWED tiles near Event Videos heading.
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll("h1,h2,h3,h4,div,span")].find((el) =>
      /Event Videos/i.test((el.textContent || "").trim())
    );
    if (!heading) return 0;
    let root = heading.parentElement;
    for (let i = 0; i < 4 && root; i += 1) {
      const imgs = root.querySelectorAll("img");
      if (imgs.length) return imgs.length;
      root = root.parentElement;
    }
    return 0;
  });
}

async function selectEventThumbnail(page, index, total) {
  // Try clicking the Nth visible event tile / image button under Event Videos.
  const tiles = page.locator(
    "button:has(img), [class*='carousel'] button, [class*='event-card'], [class*='EventCard']"
  );
  const tileCount = await tiles.count().catch(() => 0);
  if (tileCount > index) {
    const tile = tiles.nth(index);
    if (await tile.isVisible().catch(() => false)) {
      await tile.scrollIntoViewIfNeeded().catch(() => {});
      await clickStable(tile);
      await sleep(600);
      return;
    }
  }

  // Use next-arrow navigation from the first event.
  if (index === 0) return;
  const next = page
    .locator("button")
    .filter({ has: page.locator("svg, i, span") })
    .filter({ hasText: /^$/ })
    .last();
  // Prefer an explicit next control near EVENTS pager.
  const nextArrow = page
    .getByRole("button", { name: /next|›|>/i })
    .or(page.locator("button[aria-label*='next' i], button[aria-label*='Next' i]"))
    .first();
  if (await nextArrow.isVisible().catch(() => false)) {
    await clickStable(nextArrow);
    await sleep(600);
    return;
  }

  // Last resort: click any right-chevron near the event carousel.
  const chevron = page.locator("button").nth(-1);
  if (total > 1 && (await chevron.isVisible().catch(() => false))) {
    await chevron.click({ force: true }).catch(() => {});
    await sleep(500);
  }
}

async function playCurrentVideo(page, { minPlayMs = 1100, forceScroll = false } = {}) {
  const play = await findPlayButton(page);
  if (!play) {
    console.log("[coaching] Play control not found — waiting briefly anyway");
    await sleep(minPlayMs);
    return;
  }

  if (forceScroll) {
    await play.scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 280)).catch(() => {});
    await sleep(300);
  } else {
    await play.scrollIntoViewIfNeeded().catch(() => {});
  }

  // If already playing (pause visible), still ensure ≥1s watch time.
  const label = ((await play.getAttribute("aria-label").catch(() => "")) || "").toLowerCase();
  const title = ((await play.getAttribute("title").catch(() => "")) || "").toLowerCase();
  const isPause = /pause/.test(label) || /pause/.test(title);

  if (!isPause) {
    await clickStable(play, { forceAfterMs: 2000 });
  }
  await sleep(minPlayMs);
}

async function findPlayButton(page) {
  const byRole = page.getByRole("button", { name: /^Play$/i }).first();
  if (await byRole.isVisible().catch(() => false)) return byRole;

  const byAria = page.locator("button[aria-label*='Play' i], [aria-label='Play']").first();
  if (await byAria.isVisible().catch(() => false)) return byAria;

  // Control bar center play triangle (common Lytx player).
  const candidates = page.locator(
    [
      "button.vjs-play-control",
      ".vjs-play-control",
      "button[class*='play' i]",
      "[class*='playback'] button",
      "[class*='player'] button",
      "button:has(svg)",
    ].join(", ")
  );
  const count = await candidates.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const btn = candidates.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const text = ((await btn.innerText().catch(() => "")) || "").trim();
    const aria = ((await btn.getAttribute("aria-label").catch(() => "")) || "").toLowerCase();
    if (/play/i.test(aria) || text === "" || /^play$/i.test(text)) {
      // Prefer ones near the video area (lower half of viewport after scroll).
      return btn;
    }
  }

  // Heuristic: middle control in the visible player toolbar.
  const toolbarPlay = page
    .locator("[class*='control'] button, [class*='ControlBar'] button")
    .nth(1);
  if (await toolbarPlay.isVisible().catch(() => false)) return toolbarPlay;
  return null;
}

async function waitForBehaviorsCleared(page, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cleared = await page
      .getByText(/0 Behaviors Left to Coach/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (cleared) return true;
    await sleep(500);
  }
  return false;
}

async function completeCoachingSession(page) {
  // Complete Session sits at the bottom of the page.
  const completeSession = page
    .getByRole("button", { name: /^Complete Session$/i })
    .or(page.getByText(/^Complete Session$/i))
    .first();

  await completeSession.waitFor({ state: "visible", timeout: 60000 });
  await completeSession.scrollIntoViewIfNeeded().catch(() => {});
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await sleep(400);
  await clickStable(completeSession, { forceAfterMs: 3000 });

  // Modal: Save and complete your coaching session? → Complete
  const confirmComplete = page
    .getByRole("button", { name: /^Complete$/i })
    .or(page.locator("#modalShellPrimaryButton"))
    .filter({ hasText: /^Complete$/i })
    .first();

  // Prefer dialog-scoped Complete.
  const dialogComplete = page
    .getByRole("dialog")
    .getByRole("button", { name: /^Complete$/i })
    .first();
  if (await dialogComplete.isVisible().catch(() => false)) {
    await sleep(300);
    await clickStable(dialogComplete, { forceAfterMs: 2000 });
  } else {
    await confirmComplete.waitFor({ state: "visible", timeout: 30000 });
    await sleep(300);
    await clickStable(confirmComplete, { forceAfterMs: 2000 });
  }

  // Saved modal → Close (not Download PDF)
  await page
    .getByText(/Coaching session saved/i)
    .first()
    .waitFor({ state: "visible", timeout: 60000 })
    .catch(() => {});

  const closeBtn = page
    .getByRole("dialog")
    .getByRole("button", { name: /^Close$/i })
    .or(page.getByRole("button", { name: /^Close$/i }))
    .first();
  await closeBtn.waitFor({ state: "visible", timeout: 30000 });
  await sleep(300);
  await clickStable(closeBtn, { forceAfterMs: 2000 });
  await closeBtn.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await dismissOverlays(page);
}

export async function dismissOverlays(page) {
  for (let i = 0; i < 3; i += 1) {
    const modal = page.locator("ngb-modal-window, .modal.show, [role='dialog']").first();
    if (!(await modal.isVisible().catch(() => false))) break;

    // Never auto-click Complete here — that belongs to the coaching flow.
    const close = page.getByRole("button", { name: /Close|Cancel/i }).first();
    if (await close.isVisible().catch(() => false)) {
      await close.click({ force: true }).catch(() => {});
      await sleep(400);
      continue;
    }

    await page.keyboard.press("Escape").catch(() => {});
    await sleep(400);
  }
}

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
