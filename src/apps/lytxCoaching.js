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
 * Complete Session only appears after every event video has been played.
 */
export async function coachOneSession(page, selectors = {}) {
  await dismissOverlays(page);

  const openBtn = coachButton(page).first();
  await openBtn.waitFor({ state: "visible", timeout: 30000 });
  const label = ((await openBtn.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  await clickStable(openBtn);
  console.log(`[coaching] Opened session via "${label || "Coach Event"}"`);

  // Do not wait for Complete Session here — it is hidden until all clips are played.
  await page
    .getByText(/DRIVER COACHING SESSION|Event Videos/i)
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
  await sleep(1000);

  const played = await playAllEventVideosUntilReady(page, selectors);
  console.log(`[coaching] All event videos played (${played} play action(s))`);

  await completeCoachingSession(page);
  await ensureDueForCoachingPage(page, { coaching: { selectors } }).catch(() => {});
  await waitForCoachListReady(page, { timeoutMs: 12000 }).catch(() => {});
  await sleep(500);

  return { played, label };
}

/**
 * Play clips until Complete Session appears.
 *
 * - Multiple videos: click each carousel thumbnail/image, wait 2s, next
 * - Single video: scroll down a bit and click the actual Play button
 */
async function playAllEventVideosUntilReady(page, selectors = {}) {
  const thumbWaitMs = Number(selectors.thumbWaitMs || 2000);
  const minPlayMs = Number(selectors.minPlayMs || 1100);
  const maxPasses = Number(selectors.maxPlayPasses || 3);
  let totalPlays = 0;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    await scrollToEventVideosHeading(page);
    const eventCount = (await readEventVideoCount(page)) || 1;
    console.log(`[coaching] Play pass ${pass}/${maxPasses} — ${eventCount} event(s)`);

    if (eventCount <= 1) {
      await playSingleEventWithPlayButton(page, { minPlayMs });
      totalPlays += 1;
    } else {
      totalPlays += await playMultipleEventThumbnails(page, eventCount, { thumbWaitMs });
    }

    const ready = await sessionReadyToComplete(page);
    if (ready) {
      console.log(`[coaching] Session ready to complete (${ready})`);
      return totalPlays;
    }
    console.log("[coaching] Complete Session not visible yet — another play pass");
  }

  const ready = await sessionReadyToComplete(page, { timeoutMs: 5000 });
  if (ready) return totalPlays;
  throw new Error(
    "Played event videos but Complete Session did not appear — clips may not have registered as viewed"
  );
}

async function sessionReadyToComplete(page, { timeoutMs = 8000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    const completeVisible = await page
      .locator("button, a, [role='button']")
      .filter({ hasText: /Complete Session/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (completeVisible) return "complete-session-visible";

    const zeroBehaviors = await page
      .getByText(/0 Behaviors Left to Coach/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (zeroBehaviors) return "zero-behaviors";

    await scrollToEventVideosHeading(page);
    await sleep(400);
  }
  return null;
}

async function scrollToEventVideosHeading(page) {
  const heading = page.getByText(/Event Videos?/i).first();
  if (await heading.isVisible().catch(() => false)) {
    await heading.scrollIntoViewIfNeeded().catch(() => {});
  }
  await sleep(300);
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

  const tagged = await tagEventThumbnails(page);
  return tagged;
}

async function tagEventThumbnails(page) {
  return page.evaluate(() => {
    // Clear previous tags.
    document.querySelectorAll("[data-coach-thumb]").forEach((el) => {
      el.removeAttribute("data-coach-thumb");
    });

    const heading = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")].find((el) =>
      /Event Videos?\s*:/i.test((el.textContent || "").trim()) ||
      /^Event Videos?/i.test((el.textContent || "").trim())
    );

    const roots = [];
    if (heading) {
      let root = heading.parentElement;
      for (let depth = 0; depth < 8 && root; depth += 1) {
        roots.push(root);
        root = root.parentElement;
      }
    } else {
      roots.push(document.body);
    }

    const seen = new Set();
    const clickables = [];
    for (const root of roots) {
      const imgs = [...root.querySelectorAll("img")];
      for (const img of imgs) {
        const r = img.getBoundingClientRect();
        if (r.width < 50 || r.height < 35) continue;
        const clickable =
          img.closest("button, a, [role='button'], [tabindex]") || img.parentElement || img;
        if (!clickable || seen.has(clickable)) continue;
        seen.add(clickable);
        clickables.push(clickable);
      }
      if (clickables.length >= 1) break;
    }

    clickables.forEach((el, index) => {
      el.setAttribute("data-coach-thumb", String(index));
    });
    return clickables.length;
  });
}

/**
 * Multi-video: click EVERY thumbnail in order — 1, 2, 3, … — wait 2s between each.
 * Event 1 must always be clicked too (even if already selected).
 */
async function playMultipleEventThumbnails(page, eventCount, { thumbWaitMs = 2000 } = {}) {
  await scrollToEventVideosHeading(page);
  let tagged = await tagEventThumbnails(page);
  console.log(
    `[coaching] Will click events 1..${eventCount} (${tagged} thumbnail(s) tagged)`
  );

  let played = 0;
  for (let i = 0; i < eventCount; i += 1) {
    // Keep carousel advanced so later thumbs stay findable.
    if (i > 0 && i >= tagged) {
      const nextArrow = page
        .locator("button[aria-label*='next' i], button[aria-label*='Next' i]")
        .first();
      if (await nextArrow.isVisible().catch(() => false)) {
        await clickStable(nextArrow);
        await sleep(400);
        tagged = await tagEventThumbnails(page);
      }
    }

    const byAttr = page.locator(`[data-coach-thumb="${i}"]`).first();
    const byNth = page.locator("[data-coach-thumb]").nth(i);
    let tile = null;
    if (await byAttr.count()) tile = byAttr;
    else if ((await page.locator("[data-coach-thumb]").count()) > i) tile = byNth;

    if (!tile) {
      // Last resort: retag and take nth image under Event Videos.
      tagged = await tagEventThumbnails(page);
      tile = page.locator("[data-coach-thumb]").nth(Math.min(i, Math.max(tagged - 1, 0)));
    }

    if (await tile.count()) {
      await tile.scrollIntoViewIfNeeded().catch(() => {});
      await clickStable(tile);
      console.log(`[coaching] Clicked event ${i + 1}/${eventCount}`);
    } else {
      console.log(`[coaching] MISSED event ${i + 1}/${eventCount} — no thumbnail to click`);
    }

    await sleep(thumbWaitMs);
    played += 1;
  }
  return played;
}

/**
 * Single video: scroll down a bit and click the actual Play button.
 */
async function playSingleEventWithPlayButton(page, { minPlayMs = 1100 } = {}) {
  await scrollToEventVideosHeading(page);
  await page.evaluate(() => window.scrollBy(0, 320)).catch(() => {});
  await sleep(400);

  const play = page
    .getByRole("button", { name: /^(Play|Play video|Play clip)$/i })
    .or(page.locator("button[aria-label*='Play' i], [aria-label='Play'], [title='Play']"))
    .or(page.locator("button.vjs-play-control, .vjs-big-play-button, button[class*='play' i]"))
    .first();

  if (await play.isVisible().catch(() => false)) {
    await play.scrollIntoViewIfNeeded().catch(() => {});
    await clickStable(play, { forceAfterMs: 2000 });
    console.log("[coaching] Clicked Play button (single video)");
  } else {
    // Fallback: center control near video via DOM.
    const clicked = await page.evaluate(() => {
      const video = document.querySelector("video");
      if (video) {
        video.scrollIntoView({ block: "center" });
        video.muted = true;
      }
      const btn = [...document.querySelectorAll("button, [role='button'], div, span")].find(
        (el) => {
          const aria = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`.toLowerCase();
          const cls = String(el.className || "").toLowerCase();
          return /play/.test(aria) || /play/.test(cls);
        }
      );
      if (btn) {
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      }
      if (video) {
        video.click();
        const p = video.play?.();
        if (p && typeof p.catch === "function") p.catch(() => {});
        return true;
      }
      return false;
    });
    console.log(
      clicked
        ? "[coaching] Clicked Play via DOM/video (single video)"
        : "[coaching] Play button not found (single video)"
    );
  }
  await sleep(minPlayMs);
}

async function completeCoachingSession(page) {
  // Only after all videos played — Complete Session is at the bottom.
  console.log("[coaching] Looking for Complete Session at bottom of page…");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(500);

    const completeSession = page
      .locator("button, a, [role='button']")
      .filter({ hasText: /Complete Session/i })
      .first();

    if (await completeSession.isVisible().catch(() => false)) {
      if (await completeSession.isDisabled().catch(() => false)) {
        console.log("[coaching] Complete Session disabled — need another play pass");
        await playSingleEventWithPlayButton(page, { minPlayMs: 1200 });
        continue;
      }
      await completeSession.scrollIntoViewIfNeeded().catch(() => {});
      await clickStable(completeSession, { forceAfterMs: 3000 });
      console.log("[coaching] Clicked Complete Session");
      break;
    }

    if (attempt === 7) {
      throw new Error("Complete Session not visible after playing videos");
    }
    console.log("[coaching] Complete Session not visible — retry play");
    await playSingleEventWithPlayButton(page, { minPlayMs: 1200 });
  }

  // Modal: "Save and complete your coaching session?" → Complete
  await page
    .getByText(/Save and complete your coaching session|Complete Coaching Session/i)
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => {});
  await sleep(400);

  const modalComplete = page
    .locator("#modalShellPrimaryButton")
    .or(
      page
        .locator("ngb-modal-window, .modal.show, [role='dialog']")
        .locator("button, [role='button']")
        .filter({ hasText: /^Complete$/i })
    )
    .or(page.getByRole("button", { name: /^Complete$/i }))
    .first();

  await modalComplete.waitFor({ state: "visible", timeout: 30000 });
  await clickStable(modalComplete, { forceAfterMs: 2000 });
  console.log("[coaching] Confirmed Complete in modal");

  // Saved modal → Close
  await page
    .getByText(/Coaching session saved/i)
    .first()
    .waitFor({ state: "visible", timeout: 60000 })
    .catch(() => {});

  const closeBtn = page
    .locator("ngb-modal-window, .modal.show, [role='dialog']")
    .locator("button, [role='button']")
    .filter({ hasText: /^Close$/i })
    .or(page.getByRole("button", { name: /^Close$/i }))
    .first();
  await closeBtn.waitFor({ state: "visible", timeout: 30000 });
  await clickStable(closeBtn, { forceAfterMs: 2000 });
  await closeBtn.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await dismissOverlays(page);
  console.log("[coaching] Closed saved-session modal");
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
