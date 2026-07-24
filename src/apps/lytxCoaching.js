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
 * Lytx only unlocks Complete Session after each event clip has actually
 * played (viewed). Clicking a thumbnail alone is not enough.
 *
 * - Multiple videos: select thumbnail 1..N, press Play, wait ≥2s each
 * - Single video: scroll to player and press Play
 */
async function playAllEventVideosUntilReady(page, selectors = {}) {
  const thumbWaitMs = Number(selectors.thumbWaitMs || 2000);
  const minPlayMs = Number(selectors.minPlayMs || 1100);
  const maxPasses = Number(selectors.maxPlayPasses || 4);
  let totalPlays = 0;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    await scrollToEventPlayer(page);
    const eventCount = (await readEventVideoCount(page)) || 1;
    console.log(`[coaching] Play pass ${pass}/${maxPasses} — ${eventCount} event(s)`);

    if (eventCount <= 1) {
      totalPlays += await playCurrentVideo(page, {
        minPlayMs: Math.max(minPlayMs, thumbWaitMs),
        forceScroll: true,
      });
    } else {
      totalPlays += await playMultipleEventVideos(page, eventCount, {
        thumbWaitMs,
        minPlayMs,
      });
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
    if (completeVisible) {
      const disabled = await page
        .locator("button, a, [role='button']")
        .filter({ hasText: /Complete Session/i })
        .first()
        .isDisabled()
        .catch(() => false);
      if (!disabled) return "complete-session-visible";
    }

    const zeroBehaviors = await page
      .getByText(/0 Behaviors Left to Coach/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (zeroBehaviors) return "zero-behaviors";

    await scrollToEventPlayer(page);
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

async function scrollToEventPlayer(page) {
  await scrollToEventVideosHeading(page);
  await page
    .evaluate(() => {
      const video = document.querySelector("video");
      if (video) {
        video.scrollIntoView({ block: "center", behavior: "instant" });
        return;
      }
      const label = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")].find((el) =>
        /Event Videos?/i.test((el.textContent || "").trim())
      );
      label?.scrollIntoView({ block: "start", behavior: "instant" });
    })
    .catch(() => {});
  await sleep(400);
}

async function readEventVideoCount(page) {
  const fromText = await page.evaluate(() => {
    const body = document.body?.innerText || "";
    const labeled = body.match(/Event Videos?\s*:\s*(\d+)/i);
    if (labeled) return Number(labeled[1]);
    const ofMatch = body.match(/EVENTS?\s+(\d+)\s*[-–]\s*(\d+)\s+OF\s+(\d+)/i);
    if (ofMatch) return Number(ofMatch[3]);
    const short = body.match(/EVENTS?\s+\d+\s+OF\s+(\d+)/i);
    if (short) return Number(short[1]);
    return null;
  });
  if (fromText && fromText > 0) return fromText;

  const tagged = await tagEventThumbnails(page);
  return tagged > 0 ? tagged : 1;
}

/**
 * Tag a left-to-right row of similar-sized event carousel thumbnails
 * under the Event Videos heading. Avoids logos/avatars by clustering.
 */
async function tagEventThumbnails(page, expectedCount = 0) {
  return page.evaluate((expected) => {
    document.querySelectorAll("[data-coach-thumb]").forEach((el) => {
      el.removeAttribute("data-coach-thumb");
    });

    const heading = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p,label")].find((el) => {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      return /^Event Videos?\s*:?/i.test(t) || /Event Videos?\s*:\s*\d+/i.test(t);
    });

    let searchRoot = document.body;
    if (heading) {
      let root = heading.parentElement;
      for (let depth = 0; depth < 6 && root; depth += 1) {
        const imgs = root.querySelectorAll("img");
        if (imgs.length >= Math.max(expected || 1, 2) || imgs.length >= 2) {
          searchRoot = root;
          break;
        }
        searchRoot = root;
        root = root.parentElement;
      }
    }

    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        r.width >= 48 &&
        r.height >= 32 &&
        r.bottom > 0 &&
        r.top < window.innerHeight + 200 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0.05
      );
    };

    const imgs = [...searchRoot.querySelectorAll("img")].filter(visible);
    if (!imgs.length) return 0;

    // Build horizontal clusters of similarly-sized images (carousel row).
    const items = imgs.map((img) => {
      const r = img.getBoundingClientRect();
      const clickable =
        img.closest("button, a, [role='button'], [tabindex], mat-card, .card") ||
        img.parentElement ||
        img;
      return { img, clickable, r, midY: r.top + r.height / 2, h: r.height, w: r.width };
    });

    const clusters = [];
    for (const item of items) {
      let placed = false;
      for (const cluster of clusters) {
        const ref = cluster[0];
        const sameRow = Math.abs(item.midY - ref.midY) < Math.max(24, ref.h * 0.45);
        const similarSize =
          Math.abs(item.h - ref.h) < Math.max(18, ref.h * 0.35) &&
          Math.abs(item.w - ref.w) < Math.max(40, ref.w * 0.55);
        if (sameRow && similarSize) {
          cluster.push(item);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([item]);
    }

    // Prefer a cluster whose size matches Event Videos:N, else largest plausible row.
    clusters.sort((a, b) => b.length - a.length);
    let best = clusters[0] || [];
    if (expected > 0) {
      const exact = clusters.find((c) => c.length === expected);
      const near = clusters.find((c) => c.length >= expected && c.length <= expected + 2);
      best = exact || near || best;
    }
    // Drop huge clusters (page chrome) and tiny ones.
    if (best.length > 12) {
      best = clusters.find((c) => c.length >= 2 && c.length <= 12) || best.slice(0, expected || 3);
    }

    const seen = new Set();
    const ordered = best
      .sort((a, b) => a.r.left - b.r.left)
      .map((item) => item.clickable)
      .filter((el) => {
        if (!el || seen.has(el)) return false;
        seen.add(el);
        return true;
      });

    const limited =
      expected > 0 && ordered.length > expected ? ordered.slice(0, expected) : ordered;

    limited.forEach((el, index) => {
      el.setAttribute("data-coach-thumb", String(index));
    });
    return limited.length;
  }, expectedCount || 0);
}

/**
 * Multi-video: for each event 1..N select the thumbnail, then Play the clip.
 */
async function playMultipleEventVideos(
  page,
  eventCount,
  { thumbWaitMs = 2000, minPlayMs = 1100 } = {}
) {
  await scrollToEventPlayer(page);
  const tagged = await tagEventThumbnails(page, eventCount);
  console.log(
    `[coaching] Will play events 1..${eventCount} (${tagged} thumbnail(s) tagged)`
  );

  let played = 0;
  for (let i = 0; i < eventCount; i += 1) {
    const selected = await selectEventThumbnail(page, i, eventCount);
    console.log(
      selected
        ? `[coaching] Selected event ${i + 1}/${eventCount} via ${selected}`
        : `[coaching] Could not select event ${i + 1}/${eventCount} — playing current`
    );
    await sleep(350);
    played += await playCurrentVideo(page, {
      minPlayMs: Math.max(minPlayMs, thumbWaitMs),
      forceScroll: true,
    });
    console.log(`[coaching] Played event ${i + 1}/${eventCount}`);
  }
  return played;
}

async function selectEventThumbnail(page, index, eventCount) {
  await scrollToEventVideosHeading(page);
  let tagged = await tagEventThumbnails(page, eventCount);

  // If later thumbs are off-screen in a carousel, nudge with Next.
  if (index > 0 && tagged > 0 && index >= tagged) {
    for (let nudge = 0; nudge < index - tagged + 2; nudge += 1) {
      const moved = await clickCarouselNext(page);
      if (!moved) break;
      await sleep(350);
      tagged = await tagEventThumbnails(page, eventCount);
      if (index < tagged) break;
    }
  }

  const tile = page.locator(`[data-coach-thumb="${index}"]`).first();
  if (await tile.count()) {
    await tile.scrollIntoViewIfNeeded().catch(() => {});
    await clickStable(tile);
    return `thumb-${index}`;
  }

  // Fallback: click Nth tagged thumb if indexes shifted.
  const all = page.locator("[data-coach-thumb]");
  const count = await all.count();
  if (count > 0 && index < count) {
    await clickStable(all.nth(index));
    return `thumb-nth-${index}`;
  }

  if (index > 0) {
    const moved = await clickCarouselNext(page);
    if (moved) return "carousel-next";
  }
  return null;
}

async function clickCarouselNext(page) {
  const nextArrow = page
    .locator(
      [
        "button[aria-label*='next' i]",
        "button[aria-label*='Next' i]",
        "button[aria-label*='forward' i]",
        "[class*='carousel'] button[aria-label*='next' i]",
      ].join(", ")
    )
    .or(page.getByRole("button", { name: /^Next$/i }))
    .first();
  if (await nextArrow.isVisible().catch(() => false)) {
    await clickStable(nextArrow);
    return true;
  }
  return false;
}

/**
 * Press Play on the current event video and wait so Lytx marks it viewed.
 */
async function playCurrentVideo(page, { minPlayMs = 1100, forceScroll = false } = {}) {
  if (forceScroll) await scrollToEventPlayer(page);

  const video = page.locator("video").first();
  if (await video.isVisible().catch(() => false)) {
    await video.hover().catch(() => {});
    await sleep(200);
  }

  const clicked = await clickPlayControl(page);
  if (clicked) {
    console.log(`[coaching] Play clicked (${clicked})`);
  } else if (await video.isVisible().catch(() => false)) {
    await video.click({ force: true }).catch(() => {});
    await page
      .evaluate(() => {
        const v = document.querySelector("video");
        if (!v) return;
        v.muted = true;
        const p = v.play?.();
        if (p && typeof p.catch === "function") p.catch(() => {});
      })
      .catch(() => {});
    console.log("[coaching] Play via video element / media.play()");
  } else {
    await page.keyboard.press("Space").catch(() => {});
    console.log("[coaching] Play via Space (no video node found)");
  }

  await sleep(minPlayMs);

  // If still paused, one more attempt.
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
        if (!v) return;
        v.muted = true;
        const p = v.play?.();
        if (p && typeof p.catch === "function") p.catch(() => {});
      })
      .catch(() => {});
    await sleep(minPlayMs);
  }
  return 1;
}

async function clickPlayControl(page) {
  const named = page
    .getByRole("button", { name: /^(Play|Play video|Play clip)$/i })
    .or(page.locator("button[aria-label*='Play' i], [aria-label='Play'], [title='Play']"))
    .first();
  if (await named.isVisible().catch(() => false)) {
    await clickStable(named, { forceAfterMs: 1500 });
    return "named";
  }

  const classic = page
    .locator(
      [
        "button.vjs-big-play-button",
        ".vjs-big-play-button",
        "button.vjs-play-control",
        ".vjs-play-control.vjs-paused",
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

  const viaDom = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        r.width > 10 &&
        r.height > 10 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0.05
      );
    };

    const video = document.querySelector("video");
    const videoRect = video?.getBoundingClientRect();
    const candidates = [...document.querySelectorAll("button, [role='button'], div, span")];

    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
      if (!visible(el)) continue;
      const aria = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""}`.toLowerCase();
      const cls = String(el.className || "").toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      const looksPlay =
        /\bplay\b/.test(aria) ||
        /\bplay\b/.test(cls) ||
        text === "play" ||
        /vjs-big-play|big-play|play-control/.test(cls);
      if (!looksPlay) continue;

      const r = el.getBoundingClientRect();
      let score = 10;
      if (videoRect) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const inside =
          cx >= videoRect.left - 40 &&
          cx <= videoRect.right + 40 &&
          cy >= videoRect.top - 40 &&
          cy <= videoRect.bottom + 40;
        if (inside) score += 50;
      }
      if (/big-play|vjs-big-play/.test(cls)) score += 20;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best) return false;
    best.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  });

  return viaDom ? "dom" : null;
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
        await playCurrentVideo(page, { minPlayMs: 1200, forceScroll: true });
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
    await playCurrentVideo(page, { minPlayMs: 1200, forceScroll: true });
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
