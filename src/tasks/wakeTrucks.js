import { openLytxVehicles } from "../browser.js";
import {
  collectNotBrowseTrucks,
  ensureVehiclesListPage,
  refreshVehiclesList,
  runWakePass,
  setVehiclesPageSize,
} from "../apps/lytxWakeTrucks.js";
import { writeTaskStatus } from "../utils/taskStatus.js";

/**
 * Wake Trucks (Lytx Video Search → Vehicles, separate Lytx account).
 *
 * On each run:
 * 1. Set Show: 100 Vehicles
 * 2. Pass 1 — click Wake / Retry on every page (1s between clicks)
 * 3. Wait 5 minutes
 * 4. Pass 2 — same
 * 5. Wait 5 minutes
 * 6. Report trucks still not on Browse
 */
export async function runWakeTrucks(config) {
  const wake = config.wakeTrucks || {};
  const vehiclesApp = config.apps?.vehicles || {};
  const pageSize = wake.pageSize ?? 100;
  const clickDelayMs = wake.clickDelayMs ?? 1000;
  const waitMs = wake.waitBetweenPassesMs ?? 5 * 60 * 1000;

  const { browser, page } = await openLytxVehicles(config);

  writeTaskStatus("wake-trucks", {
    state: "running",
    message: "Opening Lytx Video Search → Vehicles",
    pass: 0,
    clicked: 0,
    stillNotBrowse: [],
  });

  try {
    await ensureVehiclesListPage(page, vehiclesApp, wake);
    await setVehiclesPageSize(page, pageSize);

    console.log("[wake] Pass 1 starting…");
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: "Pass 1 — clicking Wake / Retry on all pages",
      pass: 1,
    });
    const pass1 = await runWakePass(page, { clickDelayMs, passNumber: 1 });
    console.log(`[wake] Pass 1 done — clicked ${pass1.clicked} on ${pass1.pages} page(s)`);

    console.log(`[wake] Waiting ${waitMs / 1000}s before pass 2…`);
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: `Waiting ${Math.round(waitMs / 60000)} min before pass 2…`,
      pass: 1,
      clicked: pass1.clicked,
    });
    await sleep(waitMs);

    await refreshVehiclesList(page, vehiclesApp, wake, pageSize);
    console.log("[wake] Pass 2 starting…");
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: "Pass 2 — clicking Wake / Retry on all pages",
      pass: 2,
      clicked: pass1.clicked,
    });
    const pass2 = await runWakePass(page, { clickDelayMs, passNumber: 2 });
    console.log(`[wake] Pass 2 done — clicked ${pass2.clicked} on ${pass2.pages} page(s)`);

    console.log(`[wake] Waiting ${waitMs / 1000}s before final scan…`);
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: `Waiting ${Math.round(waitMs / 60000)} min before final scan…`,
      pass: 2,
      clicked: pass1.clicked + pass2.clicked,
    });
    await sleep(waitMs);

    await refreshVehiclesList(page, vehiclesApp, wake, pageSize);
    console.log("[wake] Final scan — trucks still not Browse…");
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: "Scanning for trucks still not on Browse",
      pass: 3,
    });
    const stillNotBrowse = await collectNotBrowseTrucks(page);

    console.log("\n=== TRUCKS STILL NOT ON BROWSE ===");
    if (!stillNotBrowse.length) {
      console.log("(none — all trucks show Browse)");
    } else {
      const retryCount = stillNotBrowse.filter((r) => r.status === "retry").length;
      if (retryCount) {
        console.log(`--- ${retryCount} Could not wake / Retry ---`);
        for (const row of stillNotBrowse.filter((r) => r.status === "retry")) {
          console.log(`${row.vehicleId}: ${row.detail}`);
        }
      }
      console.log("--- All trucks still not on Browse ---");
      for (const row of stillNotBrowse) {
        console.log(`${row.vehicleId}: ${row.detail}`);
      }
    }
    console.log(`=== ${stillNotBrowse.length} truck(s) ===\n`);

    writeTaskStatus("wake-trucks", {
      state: "done",
      message:
        stillNotBrowse.length === 0
          ? "Done — all trucks on Browse"
          : `${stillNotBrowse.length} truck(s) still not on Browse`,
      pass: 3,
      clicked: pass1.clicked + pass2.clicked,
      pass1Clicks: pass1.clicked,
      pass2Clicks: pass2.clicked,
      stillNotBrowse,
      stillNotBrowseCount: stillNotBrowse.length,
    });
  } catch (error) {
    writeTaskStatus("wake-trucks", {
      state: "error",
      message: error.message || String(error),
    });
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
