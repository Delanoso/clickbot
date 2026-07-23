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
 * Play every event clip (≥1s each) and keep going until Lytx shows the session
 * is ready to complete (0 behaviors left and/or Complete Session visible).
 */
async function playAllEventVideosUntilReady(page, selectors = {}) {
  const minPlayMs = Number(selectors.minPlayMs || 1100);
  const maxPasses = Number(selectors.maxPlayPasses || 4);
  let totalPlays = 0;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    await scrollToEventPlayer(page);
    const eventCount = (await readEventVideoCount(page)) || 1;
    console.log(`[coaching] Play pass ${pass}/${maxPasses} — ${eventCount} event(s)`);

    if (eventCount <= 1) {
      await playCurrentVideo(page, { minPlayMs, forceScroll: true });
      totalPlays += 1;
    } else {
      for (let i = 0; i < eventCount; i += 1) {
        console.log(`[coaching] Playing event ${i + 1}/${eventCount}`);
        await selectEventThumbnail(page, i, eventCount);
        await scrollToEventPlayer(page);
        await playCurrentVideo(page, { minPlayMs, forceScroll: true });
        totalPlays += 1;
      }
    }

    const ready = await sessionReadyToComplete(page);
    if (ready) {
      console.log(`[coaching] Session ready to complete (${ready})`);
      return totalPlays;
    }

    console.log(
      "[coaching] Not ready yet (Complete Session still hidden) — replaying remaining clips"
    );
  }

  // One last readiness check before giving up.
  const ready = await sessionReadyToComplete(page, { timeoutMs: 5000 });
  if (ready) return totalPlays;

  throw new Error(
    "Played event videos but Complete Session did not appear — clips may not have registered as viewed"
  );
}

async function sessionReadyToComplete(page, { timeoutMs = 8000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const zeroBehaviors = await page
      .getByText(/0 Behaviors Left to Coach/i)
      .first()
      .isVisible()
      .catch(() => false);

    // Peek at the bottom without requiring the button yet.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    const completeVisible = await page
      .locator("button, a, [role='button']")
      .filter({ hasText: /Complete Session/i })
      .first()
      .isVisible()
      .catch(() => false);

    if (completeVisible) return "complete-session-visible";
    if (zeroBehaviors) {
      // Behaviors cleared but button may still be painting — keep scrolling briefly.
      await sleep(500);
      if (
        await page
          .locator("button, a, [role='button']")
          .filter({ hasText: /Complete Session/i })
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        return "complete-session-visible";
      }
      return "zero-behaviors";
    }

    // Scroll back up to the player for another pass.
    await scrollToEventPlayer(page);
    await sleep(400);
  }
  return null;
}

async function playAllEventVideos(page, selectors = {}) {
  return playAllEventVideosUntilReady(page, selectors);
}

async function scrollToEventPlayer(page) {
  const heading = page.getByText(/Event Videos?/i).first();
  if (await heading.isVisible().catch(() => false)) {
    await heading.scrollIntoViewIfNeeded().catch(() => {});
  }
  await page
    .evaluate(() => {
      const video = document.querySelector("video");
      if (video) {
        video.scrollIntoView({ block: "center", behavior: "instant" });
        return;
      }
      const label = [...document.querySelectorAll("h1,h2,h3,h4,div,span")].find((el) =>
        /Event Videos?/i.test((el.textContent || "").trim())
      );
      label?.scrollIntoView({ block: "start", behavior: "instant" });
    })
    .catch(() => {});
  await sleep(500);
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
      await sleep(800);
      return;
    }
  }

  if (index === 0) return;

  const nextArrow = page
    .locator(
      "button[aria-label*='next' i], button[aria-label*='Next' i], button[aria-label*='forward' i]"
    )
    .or(page.getByRole("button", { name: /next/i }))
    .first();
  if (await nextArrow.isVisible().catch(() => false)) {
    await clickStable(nextArrow);
    await sleep(800);
  }
}

async function playCurrentVideo(page, { minPlayMs = 1100, forceScroll = false } = {}) {
  if (forceScroll) await scrollToEventPlayer(page);

  // Hover the player so custom controls appear.
  const video = page.locator("video").first();
  if (await video.isVisible().catch(() => false)) {
    await video.hover().catch(() => {});
    await sleep(250);
  }

  const clicked = await clickPlayControl(page);
  if (!clicked) {
    // Last resorts: click the video surface, then Space.
    if (await video.isVisible().catch(() => false)) {
      await video.click({ force: true }).catch(() => {});
      await page.evaluate(() => {
        const v = document.querySelector("video");
        if (v) {
          v.muted = true;
          const p = v.play?.();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      }).catch(() => {});
      console.log("[coaching] Play via video element / media.play()");
    } else {
      await page.keyboard.press("Space").catch(() => {});
      console.log("[coaching] Play via Space (no video node found)");
    }
  } else {
    console.log(`[coaching] Play clicked (${clicked})`);
  }

  await sleep(minPlayMs);

  // Best-effort: if still paused, try once more.
  const paused = await page
    .evaluate(() => {
      const v = document.querySelector("video");
      return v ? v.paused : null;
    })
    .catch(() => null);
  if (paused === true) {
    await clickPlayControl(page);
    await page
      .evaluate(() => {
        const v = document.querySelector("video");
        if (v) {
          v.muted = true;
          const p = v.play?.();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      })
      .catch(() => {});
    await sleep(minPlayMs);
  }
}

async function clickPlayControl(page) {
  // 1) Accessible name / aria
  const named = page
    .getByRole("button", { name: /^(Play|Play video|Play clip)$/i })
    .or(page.locator("button[aria-label*='Play' i], [aria-label='Play'], [title='Play']"))
    .first();
  if (await named.isVisible().catch(() => false)) {
    await clickStable(named, { forceAfterMs: 1500 });
    return "named";
  }

  // 2) Common player class names
  const classic = page
    .locator(
      [
        "button.vjs-play-control",
        ".vjs-play-control",
        "button.vjs-big-play-button",
        ".vjs-big-play-button",
        "button[class*='play' i]",
        "[class*='PlayButton' i]",
        "[data-test-id*='play' i]",
      ].join(", ")
    )
    .first();
  if (await classic.isVisible().catch(() => false)) {
    await clickStable(classic, { forceAfterMs: 1500 });
    return "classic";
  }

  // 3) DOM heuristic: visible control near the video with a play icon / empty center button
  const viaDom = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        r.width > 8 &&
        r.height > 8 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        style.opacity !== "0"
      );
    };

    const video = document.querySelector("video");
    const videoRect = video?.getBoundingClientRect();

    const score = (el) => {
      const r = el.getBoundingClientRect();
      let s = 0;
      const aria = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`.toLowerCase();
      const cls = (el.className || "").toString().toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      if (/play/.test(aria) || /play/.test(cls) || text === "play") s += 50;
      if (/pause/.test(aria) || /pause/.test(cls)) s -= 100;
      if (videoRect) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const nearX = Math.abs(cx - (videoRect.left + videoRect.width / 2));
        const nearY = Math.abs(cy - (videoRect.bottom + 20));
        s += Math.max(0, 40 - nearX / 20);
        s += Math.max(0, 40 - nearY / 10);
      }
      // Centered small control buttons are usually play.
      if (r.width >= 24 && r.width <= 72 && r.height >= 24 && r.height <= 72) s += 15;
      return s;
    };

    const nodes = [
      ...document.querySelectorAll("button, [role='button'], a, div, span, i, svg"),
    ].filter(visible);
    nodes.sort((a, b) => score(b) - score(a));
    const best = nodes[0];
    if (best && score(best) >= 40) {
      best.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }

    // Big overlay play in the middle of the video.
    if (videoRect) {
      const mid = nodes.find((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        return (
          cx > videoRect.left + videoRect.width * 0.35 &&
          cx < videoRect.left + videoRect.width * 0.65 &&
          cy > videoRect.top + videoRect.height * 0.35 &&
          cy < videoRect.top + videoRect.height * 0.65 &&
          r.width >= 30 &&
          r.width <= 120
        );
      });
      if (mid) {
        mid.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      }
    }
    return false;
  });

  return viaDom ? "dom" : null;
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
  // Only call this after sessionReadyToComplete — button appears once all clips played.
  console.log("[coaching] Looking for Complete Session at bottom of page…");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(500);

    const completeSession = page
      .locator("button, a, [role='button']")
      .filter({ hasText: /Complete Session/i })
      .first();

    if (await completeSession.isVisible().catch(() => false)) {
      await completeSession.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(300);
      if (await completeSession.isDisabled().catch(() => false)) {
        console.log("[coaching] Complete Session still disabled — clips not fully registered");
        await scrollToEventPlayer(page);
        await playCurrentVideo(page, { minPlayMs: 1200, forceScroll: true });
        continue;
      }
      await clickStable(completeSession, { forceAfterMs: 3000 });
      console.log("[coaching] Clicked Complete Session");
      break;
    }

    if (attempt === 7) {
      const snippet = await page.evaluate(() =>
        (document.body?.innerText || "").slice(-800)
      );
      throw new Error(
        `Complete Session not visible yet (videos may still be unplayed). Page tail: ${snippet
          .replace(/\s+/g, " ")
          .slice(0, 400)}`
      );
    }

    // Button still missing — play current clip again, then re-check.
    console.log("[coaching] Complete Session not visible — playing current clip again");
    await scrollToEventPlayer(page);
    await playCurrentVideo(page, { minPlayMs: 1200, forceScroll: true });
  }

  // Modal: Save and complete your coaching session? → Complete
  const dialogComplete = page
    .getByRole("dialog")
    .getByRole("button", { name: /^Complete$/i })
    .first();
  const anyComplete = page
    .locator("button, [role='button']")
    .filter({ hasText: /^Complete$/i })
    .first();

  if (await dialogComplete.isVisible().catch(() => false)) {
    await sleep(300);
    await clickStable(dialogComplete, { forceAfterMs: 2000 });
  } else {
    await anyComplete.waitFor({ state: "visible", timeout: 30000 });
    await sleep(300);
    await clickStable(anyComplete, { forceAfterMs: 2000 });
  }
  console.log("[coaching] Confirmed Complete in modal");

  // Saved modal → Close (not Download PDF)
  await page
    .getByText(/Coaching session saved/i)
    .first()
    .waitFor({ state: "visible", timeout: 60000 })
    .catch(() => {});

  const closeBtn = page
    .getByRole("dialog")
    .getByRole("button", { name: /^Close$/i })
    .or(page.locator("button, [role='button']").filter({ hasText: /^Close$/i }))
    .first();
  await closeBtn.waitFor({ state: "visible", timeout: 30000 });
  await sleep(300);
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
