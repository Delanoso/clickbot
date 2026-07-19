import { openLytxOnly } from "../browser.js";
import {
  dismissOverlays,
  ensureFyiNotifyPage,
  hasFyiPreview,
  readFyiRemainingCount,
  recoverFyiList,
  resolveOneFyiNotify,
} from "../apps/lytxFyi.js";

/**
 * Task 2: clear Lytx FYI Notify items (Lytx only).
 *
 * Flow (one iteration):
 * 1. Open FYI NOTIFY from the dashboard
 * 2. Click Preview on the first card
 * 3. Scroll to Resolve → Yes, Confirm
 * 4. Repeat until remaining count is 0 (not just a brief empty Preview list)
 */
export async function runFyiNotify(config) {
  const { browser, page } = await openLytxOnly(config);
  const fyiConfig = {
    ...config.apps.dispatch,
    fyi: config.apps.dispatch.fyi || config.fyi || {},
  };
  const selectors = fyiConfig.fyi?.selectors || {};

  await ensureFyiNotifyPage(page, fyiConfig);

  const maxRuns = config.loop?.maxRuns ?? 0;
  let run = 0;
  let failStreak = 0;
  let emptyStreak = 0;

  console.log("Lytx FYI Notify open. Starting resolve loop.");
  console.log(maxRuns > 0 ? `maxRuns=${maxRuns}` : "Running until no FYI Notify items remain.");
  console.log("Press Ctrl+C to stop.\n");

  try {
    while (config.loop?.enabled !== false) {
      run += 1;
      if (maxRuns > 0 && run > maxRuns) {
        console.log(`Reached maxRuns (${maxRuns}). Stopping.`);
        break;
      }

      if (!(await hasFyiPreview(page))) {
        const remaining = await readFyiRemainingCount(page);
        if (remaining === 0) {
          console.log("FYI Notify remaining count is 0. Done.");
          break;
        }

        emptyStreak += 1;
        console.log(
          `No Preview buttons yet (remaining=${remaining ?? "?"}, emptyStreak=${emptyStreak}).`
        );
        const recovered = await recoverFyiList(page, fyiConfig);
        if (!recovered) {
          const after = await readFyiRemainingCount(page);
          if (after === 0 || (emptyStreak >= 3 && !(await hasFyiPreview(page)))) {
            console.log(
              after === 0
                ? "FYI Notify remaining count is 0. Done."
                : "Still no Preview after refresh attempts — stopping."
            );
            break;
          }
        } else {
          emptyStreak = 0;
        }
        if (!(await hasFyiPreview(page))) {
          continue;
        }
      } else {
        emptyStreak = 0;
      }

      const remainingBefore = await readFyiRemainingCount(page);
      console.log(
        `--- FYI Run ${run} ---${
          remainingBefore != null ? ` (remaining ~${remainingBefore})` : ""
        }`
      );
      try {
        await resolveOneFyiNotify(page, selectors);
        failStreak = 0;
        const remainingAfter = await readFyiRemainingCount(page);
        console.log(
          `Resolved one FYI Notify event.${
            remainingAfter != null ? ` Remaining ~${remainingAfter}.` : ""
          }`
        );
      } catch (error) {
        failStreak += 1;
        console.log(`FYI resolve failed (will retry): ${error.message || error}`);
        try {
          await page.keyboard.press("Escape").catch(() => {});
          await sleep(500);
          await dismissOverlays(page);
          await recoverFyiList(page, fyiConfig);
        } catch (recoverError) {
          console.log(`FYI UI recovery failed, reloading: ${recoverError.message || recoverError}`);
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
          await sleep(1500);
          await ensureFyiNotifyPage(page, fyiConfig).catch(() => {});
        }
        if (failStreak >= 5) {
          console.log("FYI resolve failed 5 times in a row — stopping.");
          break;
        }
        continue;
      }

      const delay = config.loop?.delayBetweenRunsMs ?? 800;
      if (delay > 0) {
        await sleep(delay);
      }
    }
  } finally {
    await browser.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
