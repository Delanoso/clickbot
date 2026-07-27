import { openLytxVehicles } from "../browser.js";
import {
  collectNotBrowseTrucks,
  ensureVehiclesListPage,
  runWakePass,
  setVehiclesPageSize,
} from "../apps/lytxWakeTrucks.js";
import { writeTaskStatus } from "../utils/taskStatus.js";

/**
 * Wake Trucks (Lytx Video Search → Vehicles, separate Lytx account).
 *
 * Each phase uses a fresh browser session so the Lytx vehicle table
 * always loads reliably (the SPA table goes stale after idle waits).
 */
export async function runWakeTrucks(config) {
  const wake = config.wakeTrucks || {};
  const vehiclesApp = config.apps?.vehicles || {};
  const pageSize = wake.pageSize ?? 100;
  const clickDelayMs = wake.clickDelayMs ?? 1000;
  const waitMs = wake.waitBetweenPassesMs ?? 3 * 60 * 1000;

  writeTaskStatus("wake-trucks", {
    state: "running",
    message: "Starting Wake Trucks",
    pass: 0,
    clicked: 0,
    stillNotBrowse: [],
  });

  try {
    console.log("[wake] Pass 1 starting…");
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: "Pass 1 — clicking Wake / Retry on all pages",
      pass: 1,
    });
    const pass1 = await withVehiclesSession(config, vehiclesApp, wake, pageSize, (page) =>
      runWakePass(page, { clickDelayMs, passNumber: 1 })
    );
    console.log(`[wake] Pass 1 done — clicked ${pass1.clicked} on ${pass1.pages} page(s)`);

    if (wake.pass1Only) {
      console.log("[wake] pass1Only — stopping after pass 1");
      writeTaskStatus("wake-trucks", {
        state: "done",
        message: `Pass 1 done — clicked ${pass1.clicked} Wake/Retry`,
        pass: 1,
        clicked: pass1.clicked,
        pass1Clicks: pass1.clicked,
        pass2Clicks: 0,
      });
      return;
    }

    console.log(`[wake] Waiting ${waitMs / 1000}s before pass 2…`);
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: `Waiting ${Math.round(waitMs / 60000)} min before pass 2…`,
      pass: 1,
      clicked: pass1.clicked,
    });
    await sleep(waitMs);

    console.log("[wake] Pass 2 starting…");
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: "Pass 2 — clicking Wake / Retry on all pages",
      pass: 2,
      clicked: pass1.clicked,
    });
    const pass2 = await withVehiclesSession(config, vehiclesApp, wake, pageSize, (page) =>
      runWakePass(page, { clickDelayMs, passNumber: 2 })
    );
    console.log(`[wake] Pass 2 done — clicked ${pass2.clicked} on ${pass2.pages} page(s)`);

    console.log(`[wake] Waiting ${waitMs / 1000}s before final scan…`);
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: `Waiting ${Math.round(waitMs / 60000)} min before final scan…`,
      pass: 2,
      clicked: pass1.clicked + pass2.clicked,
    });
    await sleep(waitMs);

    console.log("[wake] Final scan — trucks still not Browse…");
    writeTaskStatus("wake-trucks", {
      state: "running",
      message: "Scanning for trucks still not on Browse",
      pass: 3,
    });
    const stillNotBrowse = await withVehiclesSession(config, vehiclesApp, wake, pageSize, (page) =>
      collectNotBrowseTrucks(page)
    );

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
  }
}

async function withVehiclesSession(config, vehiclesApp, wake, pageSize, fn) {
  const { browser, page } = await openLytxVehicles(config);
  try {
    await ensureVehiclesListPage(page, vehiclesApp, wake);
    await setVehiclesPageSize(page, pageSize);
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
