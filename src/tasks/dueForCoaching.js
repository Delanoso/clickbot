import { openLytxOnly } from "../browser.js";
import {
  coachOneSession,
  dismissOverlays,
  ensureDueForCoachingPage,
  hasCoachButton,
  readCoachingRemainingCount,
  recoverCoachList,
} from "../apps/lytxCoaching.js";
import { writeTaskStatus } from "../utils/taskStatus.js";

/**
 * Task: clear Lytx Due for Coaching queue (Lytx only, same account).
 *
 * Flow (one iteration):
 * 1. Open DUE FOR COACHING from the dashboard
 * 2. Click Coach Event / Coach N Events on the first card
 * 3. Play every event video ≥1 second (single-video sessions: scroll + Play)
 * 4. Scroll to Complete Session → Complete → Close
 * 5. Repeat until the queue is empty
 */
export async function runDueForCoaching(config) {
  const { browser, page } = await openLytxOnly(config);
  const coachingConfig = {
    ...config.apps.dispatch,
    coaching: config.apps.dispatch.coaching || config.coaching || {},
  };
  const selectors = coachingConfig.coaching?.selectors || {};

  await ensureDueForCoachingPage(page, coachingConfig);

  const maxRuns = config.loop?.maxRuns ?? 0;
  let run = 0;
  let failStreak = 0;
  let emptyStreak = 0;

  console.log("Lytx Due for Coaching open. Starting coach loop.");
  console.log(
    maxRuns > 0 ? `maxRuns=${maxRuns}` : "Running until no Due for Coaching items remain."
  );
  console.log("Press Ctrl+C to stop.\n");

  writeTaskStatus("due-for-coaching", {
    state: "running",
    message: "Coaching loop started",
    run: 0,
    remaining: null,
  });

  try {
    while (config.loop?.enabled !== false) {
      run += 1;
      if (maxRuns > 0 && run > maxRuns) {
        console.log(`Reached maxRuns (${maxRuns}). Stopping.`);
        break;
      }

      if (!(await hasCoachButton(page))) {
        const remaining = await readCoachingRemainingCount(page);
        if (remaining === 0) {
          console.log("Due for Coaching remaining count is 0. Done.");
          writeTaskStatus("due-for-coaching", {
            state: "done",
            message: "Queue empty",
            run,
            remaining: 0,
          });
          break;
        }

        emptyStreak += 1;
        console.log(
          `No Coach buttons yet (remaining=${remaining ?? "?"}, emptyStreak=${emptyStreak}).`
        );
        const recovered = await recoverCoachList(page, coachingConfig);
        if (!recovered) {
          const after = await readCoachingRemainingCount(page);
          if (after === 0 || (emptyStreak >= 3 && !(await hasCoachButton(page)))) {
            console.log(
              after === 0
                ? "Due for Coaching remaining count is 0. Done."
                : "Still no Coach buttons after refresh attempts — stopping."
            );
            break;
          }
        } else {
          emptyStreak = 0;
        }
        if (!(await hasCoachButton(page))) {
          continue;
        }
      } else {
        emptyStreak = 0;
      }

      const remainingBefore = await readCoachingRemainingCount(page);
      console.log(
        `--- Coaching Run ${run} ---${
          remainingBefore != null ? ` (remaining ~${remainingBefore})` : ""
        }`
      );

      try {
        const result = await coachOneSession(page, selectors);
        failStreak = 0;
        const remainingAfter = await readCoachingRemainingCount(page);
        console.log(
          `Completed coaching session${result.label ? ` (${result.label})` : ""}.` +
            (remainingAfter != null ? ` Remaining ~${remainingAfter}.` : "")
        );
        writeTaskStatus("due-for-coaching", {
          state: "running",
          message: `Coached ${result.played} video(s)`,
          run,
          remaining: remainingAfter,
          lastPlayed: result.played,
        });
      } catch (error) {
        failStreak += 1;
        console.log(`Coaching failed (will retry): ${error.message || error}`);
        try {
          await page.keyboard.press("Escape").catch(() => {});
          await sleep(500);
          await dismissOverlays(page);
          await recoverCoachList(page, coachingConfig);
        } catch (recoverError) {
          console.log(
            `Coaching UI recovery failed, reloading: ${recoverError.message || recoverError}`
          );
          await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
          await sleep(1500);
          await ensureDueForCoachingPage(page, coachingConfig).catch(() => {});
        }
        if (failStreak >= 5) {
          console.log("Coaching failed 5 times in a row — stopping.");
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
    writeTaskStatus("due-for-coaching", {
      state: "stopped",
      message: "Coaching task stopped",
    });
    await browser.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
