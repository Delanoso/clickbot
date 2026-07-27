import { openLytxVehicles } from "../browser.js";
import {
  ensureVehiclesListPage,
  runWakePass,
  setVehiclesPageSize,
} from "../apps/lytxWakeTrucks.js";
import { writeTaskStatus } from "../utils/taskStatus.js";

/**
 * Wake Trucks — single pass through all Lytx Video Search → Vehicles pages.
 * Clicks Wake / Retry on every truck that needs it and prints a run summary.
 */
export async function runWakeTrucks(config) {
  const wake = config.wakeTrucks || {};
  const vehiclesApp = config.apps?.vehicles || {};
  const pageSize = wake.pageSize ?? 100;
  const clickDelayMs = wake.clickDelayMs ?? 1000;

  writeTaskStatus("wake-trucks", {
    state: "running",
    message: "Opening Lytx Video Search → Vehicles",
    clicked: 0,
  });

  try {
    const { browser, page } = await openLytxVehicles(config);
    let pageSizeSet = false;

    try {
      await ensureVehiclesListPage(page, vehiclesApp, wake);
      await setVehiclesPageSize(page, pageSize);
      pageSizeSet = true;

      writeTaskStatus("wake-trucks", {
        state: "running",
        message: "Clicking Wake / Retry on all pages",
      });

      console.log("[wake] Run starting…");
      const result = await runWakePass(page, { clickDelayMs, passNumber: 1 });
      const summary = buildRunSummary({ pageSize, pageSizeSet, result });
      printRunSummary(summary);

      writeTaskStatus("wake-trucks", {
        state: "done",
        message: summary.dashboardMessage,
        clicked: result.clicked,
        pagesScanned: result.pages,
        maxPages: result.maxPages,
        pageResults: result.pageResults,
        clickedVehicles: result.clickedVehicles,
        warnings: result.warnings,
        summary,
      });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (error) {
    writeTaskStatus("wake-trucks", {
      state: "error",
      message: error.message || String(error),
    });
    throw error;
  }
}

function buildRunSummary({ pageSize, pageSizeSet, result }) {
  const trucks = [...result.clickedVehicles].sort((a, b) => a.localeCompare(b));

  return {
    login: "OK",
    pageSize: pageSizeSet ? `Show: ${pageSize} Vehicles` : `Show: ${pageSize} Vehicles (not confirmed)`,
    pagesScanned: `${result.pages} of ${result.maxPages}`,
    totalClicks: result.clicked,
    pageResults: result.pageResults,
    clickedVehicles: trucks,
    copyPasteLines: trucks.join("\n"),
    copyPasteCsv: trucks.join(", "),
    warnings: result.warnings,
    dashboardMessage: `${result.clicked} Wake/Retry on ${result.pages}/${result.maxPages} pages`,
  };
}

function printRunSummary(summary) {
  console.log("\n=== WAKE TRUCKS RUN SUMMARY ===");
  console.log(`Login:          ${summary.login}`);
  console.log(`Page size:      ${summary.pageSize}`);
  console.log(`Pages scanned:  ${summary.pagesScanned}`);
  console.log(`Wake/Retry:     ${summary.totalClicks} clicks`);
  console.log("");
  console.log("Per page:");
  for (const p of summary.pageResults) {
    const line = `  Page ${p.pageNum}/${p.maxPages}: ${p.rows} rows → ${p.clicked} Wake clicks`;
    console.log(p.warning ? `${line}  ⚠ ${p.warning}` : line);
  }

  if (summary.clickedVehicles.length) {
    console.log("\n=== TRUCKS WOKEN — one per line (copy for step 2) ===");
    console.log(summary.copyPasteLines);
    console.log("\n=== TRUCKS WOKEN — comma-separated (copy for step 2) ===");
    console.log(summary.copyPasteCsv);
    console.log("\n=== TRUCKS WOKEN — by page ===");
    for (const p of summary.pageResults) {
      if (p.clickedIds?.length) {
        console.log(`Page ${p.pageNum}: ${p.clickedIds.join(", ")}`);
      }
    }
  } else {
    console.log("\n(no trucks woken this run)");
  }

  if (summary.warnings.length) {
    console.log("\nWarnings:");
    for (const w of summary.warnings) console.log(`  - ${w}`);
  }
  console.log("=== END SUMMARY ===\n");
}
