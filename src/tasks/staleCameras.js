import { openLytxVehicles } from "../browser.js";
import {
  ensureVehiclesListPage,
  scanStaleCameraPages,
  setVehiclesPageSize,
} from "../apps/lytxWakeTrucks.js";
import { writeTaskStatus } from "../utils/taskStatus.js";
import { lastCommunicatedComment, parseDeviceNumber } from "../utils/lastCommunicated.js";
import { addCameraTruck, setCameraTruckComment } from "../web/cameraConfig.js";

/**
 * Stale Cameras — scan Lytx Vehicles Last communicated dates.
 * Trucks older than maxAgeDays (default 2) are added to the Truck Camera list
 * with their Lytx device number.
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
    const { browser, page } = await openLytxVehicles(config);
    let pageSizeSet = false;

    try {
      await ensureVehiclesListPage(page, vehiclesApp, { ...wake, ...staleCfg });
      await setVehiclesPageSize(page, pageSize);
      pageSizeSet = true;

      writeTaskStatus("stale-cameras", {
        state: "running",
        message: `Scanning Last communicated (older than ${maxAgeDays} days)`,
      });

      console.log(`[stale-cameras] Run starting (maxAgeDays=${maxAgeDays})…`);
      const result = await scanStaleCameraPages(page, { maxAgeDays });

      const applied = [];
      let addedCount = 0;
      let updatedCount = 0;
      let alreadyListed = 0;

      for (const row of result.stale) {
        const device = row.device || parseDeviceNumber(row.text) || "";
        try {
          const saved = addCameraTruck(row.vehicleId, { device });
          if (saved.added) {
            addedCount += 1;
            setCameraTruckComment(row.vehicleId, lastCommunicatedComment(row.lastCommunicated));
          } else if (saved.updated) {
            updatedCount += 1;
          } else {
            alreadyListed += 1;
          }
          applied.push({
            vehicleId: row.vehicleId,
            device: saved.device || device,
            lastCommunicated: row.lastCommunicated || "",
            reason: row.reason,
            added: saved.added,
            updated: saved.updated,
          });
        } catch (error) {
          console.log(
            `[stale-cameras] Could not add ${row.vehicleId} to camera list: ${error?.message || error}`
          );
        }
      }

      if (addedCount || updatedCount) {
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
      });
      printRunSummary(summary);

      writeTaskStatus("stale-cameras", {
        state: "done",
        message: summary.dashboardMessage,
        added: addedCount,
        updated: updatedCount,
        alreadyListed,
        staleCount: result.stale.length,
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
}) {
  const trucks = applied.map((row) => row.vehicleId);
  return {
    login: "OK",
    maxAgeDays,
    pageSize: pageSizeSet
      ? `Show: ${pageSize} Vehicles`
      : `Show: ${pageSize} Vehicles (not confirmed)`,
    pagesScanned: `${result.pages} of ${result.maxPages}`,
    scanned: result.scanned,
    staleCount: result.stale.length,
    addedCount,
    updatedCount,
    alreadyListed,
    skippedRecent: result.skippedRecent,
    skippedUnparsed: result.skippedUnparsed,
    pageResults: result.pageResults,
    staleTrucks: applied,
    copyPasteCsv: trucks.join(", "),
    warnings: result.warnings,
    dashboardMessage: `${result.stale.length} stale · ${addedCount} added to camera list`,
  };
}

function printRunSummary(summary) {
  console.log("\n=== STALE CAMERAS RUN SUMMARY ===");
  console.log(`Login:          ${summary.login}`);
  console.log(`Max age:        ${summary.maxAgeDays} days`);
  console.log(`Page size:      ${summary.pageSize}`);
  console.log(`Pages scanned:  ${summary.pagesScanned}`);
  console.log(`Vehicles:       ${summary.scanned}`);
  console.log(`Stale:          ${summary.staleCount}`);
  console.log(`Added:          ${summary.addedCount}`);
  console.log(`Updated device: ${summary.updatedCount}`);
  console.log(`Already listed: ${summary.alreadyListed}`);
  console.log("");
  console.log("Per page:");
  for (const page of summary.pageResults) {
    console.log(`  Page ${page.pageNum}/${page.maxPages}: ${page.rows} rows → ${page.stale} stale`);
  }

  if (summary.staleTrucks.length) {
    console.log("\n=== STALE TRUCKS (truck, device, last communicated) ===");
    for (const row of summary.staleTrucks) {
      const action = row.added ? "added" : row.updated ? "updated" : "already listed";
      console.log(
        `  ${row.vehicleId}  ${row.device || "—"}  ${row.lastCommunicated || "none"}  (${action})`
      );
    }
    console.log("\n=== comma-separated ===");
    console.log(summary.copyPasteCsv);
  } else {
    console.log("\n(no stale trucks this run)");
  }

  if (summary.warnings.length) {
    console.log("\nWarnings:");
    for (const warning of summary.warnings) console.log(`  - ${warning}`);
  }
  console.log("=== END SUMMARY ===\n");
}
