import { openLytxOnly } from "../browser.js";
import {
  ensureFyiNotifyPage,
  hasFyiPreview,
  resolveOneFyiNotify,
} from "../apps/lytxFyi.js";

/**
 * Task 2: clear Lytx FYI Notify items (Lytx only).
 *
 * Flow (one iteration):
 * 1. Open FYI NOTIFY from the dashboard
 * 2. Click Preview on the first card
 * 3. Scroll to Resolve → Yes, Confirm
 * 4. Repeat until no Preview buttons remain
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
        // Re-open list in case we landed elsewhere.
        await ensureFyiNotifyPage(page, fyiConfig);
        if (!(await hasFyiPreview(page))) {
          console.log("No more FYI Notify Preview items. Done.");
          break;
        }
      }

      console.log(`--- FYI Run ${run} ---`);
      await resolveOneFyiNotify(page, selectors);
      console.log("Resolved one FYI Notify event.");

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
