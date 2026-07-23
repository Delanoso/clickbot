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
  // Always bring the player into view first — Complete Session is further down.
  await scrollToEventPlayer(page);

  let eventCount = await readEventVideoCount(page);
  console.log(`[coaching] Event video count: ${eventCount || 1}`);

  // Single-event sessions often have no carousel — scroll to player and press play.
  if (!eventCount || eventCount <= 1) {
    await playCurrentVideo(page, { minPlayMs, forceScroll: true });
    return 1;
  }

  let played = 0;
  for (let i = 0; i < eventCount; i += 1) {
    console.log(`[coaching] Playing event ${i + 1}/${eventCount}`);
    await selectEventThumbnail(page, i, eventCount);
    await scrollToEventPlayer(page);
    await playCurrentVideo(page, { minPlayMs, forceScroll: true });
    played += 1;
  }
  return played;
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
  // Button is at the bottom — scroll first so it can render / become visible.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(400);

    const completeSession = page
      .locator("button, a, [role='button']")
      .filter({ hasText: /Complete Session/i })
      .first();

    if (await completeSession.isVisible().catch(() => false)) {
      await completeSession.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(300);
      const disabled = await completeSession.isDisabled().catch(() => false);
      if (disabled) {
        console.log("[coaching] Complete Session disabled — playing current video again");
        await scrollToEventPlayer(page);
        await playCurrentVideo(page, { minPlayMs: 1200, forceScroll: true });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await sleep(500);
      }
      if (!(await completeSession.isDisabled().catch(() => false))) {
        await clickStable(completeSession, { forceAfterMs: 3000 });
        break;
      }
    }

    if (attempt === 5) {
      // Dump nearby text for debugging, then throw.
      const snippet = await page.evaluate(() =>
        (document.body?.innerText || "").slice(-800)
      );
      throw new Error(
        `Complete Session not available after plays. Page tail: ${snippet.replace(/\s+/g, " ").slice(0, 400)}`
      );
    }
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
