import { openLytxVehicles } from "../browser.js";
import {
  ensureVehiclesListPage,
  scanStaleCameraPages,
  setVehiclesPageSize,
} from "../apps/lytxWakeTrucks.js";
import { parseDeviceNumber } from "../utils/lastCommunicated.js";
import { writeTaskStatus } from "../utils/taskStatus.js";
import { cameraMarkComment, cameraMarkLabel } from "../web/cameraMarks.js";
import { syncCameraTrucksFromStaleScan } from "../web/cameraConfig.js";

/**
 * Stale Cameras — scan Lytx Vehicles Last communicated dates.
 * Trucks older than maxAgeDays (default 2) are synced onto Truck Camera with
 * their Lytx device number. Trucks no longer on the scan are removed; trucks
 * that stay listed keep custom comments.
 */
export async function runStaleCameras(config) {
  const staleCfg = config.staleCameras || {};
  const wake = config.wakeTrucks || {};
  const vehiclesApp = config.apps?.vehicles || {};
  const pageSize = staleCfg.pageSize ?? wake.pageSize ?? 100;
  const maxAgeDays = staleCfg.maxAgeDays ?? 2;

  writeTaskStatus("stale-cameras", {
    state: "running",
    message: "Opening Lytx Video Search → Vehicles",
    added: 0,
    staleCount: 0,
  });

  try {
    writeTaskStatus("stale-cameras", {
      state: "running",
      message: "Logging in to Lytx Video Search…",
      added: 0,
      staleCount: 0,
    });
    const { browser, page } = await openLytxVehicles(config);
    let pageSizeSet = false;

    try {
      writeTaskStatus("stale-cameras", {
        state: "running",
        message: "Navigating to Vehicles list…",
      });
      await ensureVehiclesListPage(page, vehiclesApp, { ...wake, ...staleCfg });

      writeTaskStatus("stale-cameras", {
        state: "running",
        message: "Setting page size…",
      });
      await setVehiclesPageSize(page, pageSize);
      pageSizeSet = true;

      writeTaskStatus("stale-cameras", {
        state: "running",
        message: `Scanning Last communicated (older than ${maxAgeDays} days)`,
      });

      console.log(`[stale-cameras] Run starting (maxAgeDays=${maxAgeDays})…`);
      const result = await scanStaleCameraPages(page, { maxAgeDays });

      const scanRows = result.stale.map((row) => {
        const mark = row.mark || "stale";
        const device = row.device || parseDeviceNumber(row.text) || "";
        return {
          vehicleId: row.vehicleId,
          device,
          mark,
          lastCommunicated: row.lastCommunicated || "",
          comment: cameraMarkComment(mark, row.lastCommunicated),
        };
      });

      const sync = syncCameraTrucksFromStaleScan(scanRows);
      const applied = sync.applied.map((row) => ({
        ...row,
        markLabel: cameraMarkLabel(row.mark),
      }));
      const { addedCount, updatedCount, alreadyListed, removedCount, removedTrucks } = sync;

      if (sync.changed) {
        await restartCameraMonitor();
      }

      const summary = buildRunSummary({
        pageSize,
        pageSizeSet,
        maxAgeDays,
        result,
        applied,
        addedCount,
        updatedCount,
        alreadyListed,
        removedCount,
        removedTrucks,
      });
      printRunSummary(summary);

      writeTaskStatus("stale-cameras", {
        state: "done",
        message: summary.dashboardMessage,
        added: addedCount,
        updated: updatedCount,
        alreadyListed,
        removed: removedCount,
        removedTrucks,
        staleCount: result.stale.length,
        notAvailableCount: result.notAvailableCount,
        staleDateCount: result.staleDateCount,
        scanned: result.scanned,
        skippedRecent: result.skippedRecent,
        skippedUnparsed: result.skippedUnparsed,
        pagesScanned: result.pages,
        maxPages: result.maxPages,
        pageResults: result.pageResults,
        staleTrucks: applied,
        warnings: result.warnings,
        summary,
      });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (error) {
    writeTaskStatus("stale-cameras", {
      state: "error",
      message: error.message || String(error),
    });
    throw error;
  }
}

async function restartCameraMonitor() {
  const dashboardHost = process.env.DASHBOARD_HOST || "127.0.0.1";
  const dashboardPort = Number(process.env.DASHBOARD_PORT || 8787);
  try {
    await fetch(`http://${dashboardHost}:${dashboardPort}/api/tasks/camera-monitor/stop`, {
      method: "POST",
    }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await fetch(`http://${dashboardHost}:${dashboardPort}/api/tasks/camera-monitor/start`, {
      method: "POST",
    });
  } catch (error) {
    console.log(`[stale-cameras] Could not restart camera-monitor: ${error?.message || error}`);
  }
}

function buildRunSummary({
  pageSize,
  pageSizeSet,
  maxAgeDays,
  result,
  applied,
  addedCount,
  updatedCount,
  alreadyListed,
  removedCount,
  removedTrucks,
}) {
  const trucks = applied.map((row) => row.vehicleId);
  const notAvailableIds = applied
    .filter((row) => row.mark === "not_available")
    .map((row) => row.vehicleId);
  const staleDateIds = applied
    .filter((row) => row.mark === "stale")
    .map((row) => row.vehicleId);
  const copyParts = [];
  if (notAvailableIds.length) {
    copyParts.push(`NOT AVAILABLE:\n${notAvailableIds.join(", ")}`);
  }
  if (staleDateIds.length) {
    copyParts.push(`OLD LAST COMMUNICATED:\n${staleDateIds.join(", ")}`);
  }
  return {
    login: "OK",
    maxAgeDays,
    pageSize: pageSizeSet
      ? `Show: ${pageSize} Vehicles`
      : `Show: ${pageSize} Vehicles (not confirmed)`,
    pagesScanned: `${result.pages} of ${result.maxPages}`,
    scanned: result.scanned,
    staleCount: result.stale.length,
    notAvailableCount: result.notAvailableCount || 0,
    staleDateCount: result.staleDateCount || 0,
    addedCount,
    updatedCount,
    alreadyListed,
    removedCount,
    removedTrucks,
    skippedRecent: result.skippedRecent,
    skippedUnparsed: result.skippedUnparsed,
    pageResults: result.pageResults,
    staleTrucks: applied,
    copyPasteCsv: copyParts.join("\n\n") || trucks.join(", "),
    warnings: result.warnings,
    dashboardMessage: `${result.notAvailableCount || 0} not available · ${result.staleDateCount || 0} old dates · ${addedCount} added · ${removedCount} removed`,
  };
}

function printRunSummary(summary) {
  console.log("\n=== STALE CAMERAS RUN SUMMARY ===");
  console.log(`Login:          ${summary.login}`);
  console.log(`Max age:        ${summary.maxAgeDays} days`);
  console.log(`Page size:      ${summary.pageSize}`);
  console.log(`Pages scanned:  ${summary.pagesScanned}`);
  console.log(`Vehicles:       ${summary.scanned}`);
  console.log(`Not available:  ${summary.notAvailableCount}`);
  console.log(`Old dates:      ${summary.staleDateCount}`);
  console.log(`Added:          ${summary.addedCount}`);
  console.log(`Updated:        ${summary.updatedCount}`);
  console.log(`Already listed: ${summary.alreadyListed}`);
  console.log(`Removed:        ${summary.removedCount}`);
  console.log("");
  console.log("Per page:");
  for (const page of summary.pageResults) {
    console.log(
      `  Page ${page.pageNum}/${page.maxPages}: ${page.rows} rows → ${page.notAvailable || 0} not available, ${page.staleDate || page.stale || 0} old dates`
    );
  }

  if (summary.staleTrucks.length) {
    console.log("\n=== CAMERA LIST HITS (truck, mark, device, last communicated) ===");
    for (const row of summary.staleTrucks) {
      const action = row.added ? "added" : row.updated ? "updated" : "already listed";
      console.log(
        `  ${row.vehicleId}  ${row.markLabel || row.mark}  ${row.device || "—"}  ${row.lastCommunicated || "none"}  (${action})`
      );
    }
    console.log("\n=== comma-separated ===");
    console.log(summary.copyPasteCsv);
  } else {
    console.log("\n(no stale trucks this run)");
  }

  if (summary.removedTrucks?.length) {
    console.log("\n=== REMOVED FROM TRUCK CAMERA (no longer on scan) ===");
    console.log(summary.removedTrucks.join(", "));
  }

  if (summary.warnings.length) {
    console.log("\nWarnings:");
    for (const warning of summary.warnings) console.log(`  - ${warning}`);
  }
  console.log("=== END SUMMARY ===\n");
}
