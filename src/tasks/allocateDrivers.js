import {
  assignDriverInLytx,
  clearLytxVehicleFilter,
  ensureLytxAssignPage,
  filterLytxByVehicle,
  readFirstVehicle,
} from "../apps/lytx.js";
import {
  ensureWebfleetMap,
  lookupDriverInWebfleet,
} from "../apps/webfleet.js";
import { openApps } from "../browser.js";
import { resolveDriverName, shouldForceDefaultDriver } from "../utils/driverName.js";
import { writeTaskStatus } from "../utils/taskStatus.js";

/**
 * Task 1: allocate drivers to trucks (Lytx + Webfleet).
 *
 * Flow (one iteration):
 * 1. Lytx Assign Drivers — read first VEHICLE id
 *    - If blank → assign Driver Unknown (no Webfleet)
 * 2. Webfleet Drivers list — search vehicle, copy driver No. (e.g. D3309)
 * 3. Lytx — filter that vehicle, open Assign modal, paste No. (or "Driver Unknown")
 */
export async function runAllocateDrivers(config) {
  const { browser, pages } = await openApps(config);
  const { dispatch: lytx, fleet: webfleet } = pages;

  await ensureLytxAssignPage(lytx, config.apps.dispatch);
  await ensureWebfleetMap(webfleet, config.apps.fleet);

  const maxRuns = config.loop?.maxRuns ?? 0;
  let run = 0;
  let lastTruck = null;
  let sameTruckStreak = 0;
  let emptyStreak = 0;

  console.log("Lytx + Webfleet open. Starting full driver allocation loop.");
  console.log(maxRuns > 0 ? `maxRuns=${maxRuns}` : "Running until the Assign Drivers queue is empty.");
  console.log("Press Ctrl+C to stop.\n");

  writeTaskStatus("allocate-drivers", {
    state: "running",
    message: "Allocation loop started",
    run: 0,
    lastTruck: null,
    lastDriver: null,
  });

  try {
    while (config.loop?.enabled !== false) {
      run += 1;
      if (maxRuns > 0 && run > maxRuns) {
        console.log(`Reached maxRuns (${maxRuns}). Stopping.`);
        break;
      }

      // Always land on Assign Drivers with filters cleared before deciding
      // the queue is empty — a leftover vehicle chip shows 0 rows after one assign.
      await lytx.bringToFront();
      await ensureLytxAssignPage(lytx, config.apps.dispatch);
      await clearLytxVehicleFilter(lytx, config.apps.dispatch.selectors);

      let ready = await waitForAssignableRows(lytx, config.apps.dispatch.selectors);
      if (!ready) {
        console.log("Table empty after clear — reloading Assign Drivers once…");
        await lytx.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        await ensureLytxAssignPage(lytx, config.apps.dispatch);
        await clearLytxVehicleFilter(lytx, config.apps.dispatch.selectors);
        ready = await waitForAssignableRows(lytx, config.apps.dispatch.selectors);
      }

      if (!ready) {
        console.log("No more vehicles left in Assign Drivers. Done.");
        writeTaskStatus("allocate-drivers", {
          state: "done",
          message: "Queue empty",
          run,
        });
        break;
      }

      console.log(`--- Run ${run} ---`);
      let result;
      try {
        result = await allocateOne(lytx, webfleet, config);
      } catch (error) {
        if (/empty vehicle/i.test(error.message || "")) {
          emptyStreak += 1;
          console.log(`Could not assign empty vehicle row: ${error.message}`);
          if (emptyStreak >= 5 || !(await hasAssignableRows(lytx, config.apps.dispatch.selectors))) {
            console.log("No more assignable empty/vehicle rows. Done.");
            break;
          }
          continue;
        }
        throw error;
      }

      if (result.reason === "empty_truck_number") {
        emptyStreak += 1;
        console.log(
          `(no truck number) -> ${result.driverName} (empty vehicle → Driver Unknown)`
        );
        if (emptyStreak >= 5) {
          console.log(
            "Empty vehicle rows still present after 5 Driver Unknown assigns — treating queue as finished."
          );
          break;
        }
      } else {
        emptyStreak = 0;
        let suffix = "";
        if (result.reason === "sold_ldv_or_accident") {
          suffix = " (Sold/LDV/accident → Driver Unknown)";
        } else if (result.usedDropdownFallback) {
          suffix = " (fallback: not in Lytx dropdown → Driver Unknown)";
        } else if (result.usedFallback) {
          suffix = ` (fallback: ${result.reason})`;
        }
        console.log(`Truck ${result.truckNumber} -> ${result.driverName}${suffix}`);
        writeTaskStatus("allocate-drivers", {
          state: "running",
          message: `Assigned ${result.truckNumber}`,
          run,
          lastTruck: result.truckNumber,
          lastDriver: result.driverName,
          reason: result.reason || null,
        });

        if (result.truckNumber === lastTruck) {
          sameTruckStreak += 1;
        } else {
          sameTruckStreak = 1;
          lastTruck = result.truckNumber;
        }
        if (sameTruckStreak >= 3) {
          console.log(
            `Truck ${result.truckNumber} still at top after ${sameTruckStreak} assigns — forcing Driver Unknown once, then continuing.`
          );
          try {
            await clearLytxVehicleFilter(lytx, config.apps.dispatch.selectors);
            await filterLytxByVehicle(
              lytx,
              config.apps.dispatch.selectors,
              result.truckNumber
            );
            await assignDriverInLytx(
              lytx,
              config.apps.dispatch.selectors,
              config.defaultDriverName || "Driver Unknown",
              {
                defaultDriverName: config.defaultDriverName || "Driver Unknown",
                truckNumber: result.truckNumber,
              }
            );
            await clearLytxVehicleFilter(lytx, config.apps.dispatch.selectors);
          } catch (error) {
            console.log(
              `Forced Driver Unknown failed for ${result.truckNumber}: ${error.message}`
            );
            await lytx.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
            await ensureLytxAssignPage(lytx, config.apps.dispatch);
          }
          sameTruckStreak = 0;
          lastTruck = null;
        }
      }

      const delay = config.loop?.delayBetweenRunsMs ?? 2000;
      if (delay > 0) {
        await sleep(delay);
      }
    }
  } finally {
    writeTaskStatus("allocate-drivers", {
      state: "stopped",
      message: "Allocate task stopped",
    });
    await browser.close();
  }
}

async function hasAssignableRows(page, selectors) {
  const vehicleColumn =
    selectors.vehicleColumn || ".cdk-row.lytx-table-row .cdk-column-Vehicle";
  const count = await page.locator(vehicleColumn).count();
  if (count > 0) return true;
  // Fallback: any data row with an Assign control (covers blank Vehicle cells).
  const rows = page.locator(".cdk-row.lytx-table-row");
  const rowCount = await rows.count();
  if (rowCount > 0) return true;
  const assignBtn = page.getByRole("button", { name: "Assign", exact: true });
  return (await assignBtn.count()) > 0;
}

/** Poll briefly — Lytx table often lags after filter clear / assign. */
async function waitForAssignableRows(page, selectors, { attempts = 8, delayMs = 700 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    if (await hasAssignableRows(page, selectors)) return true;
    await sleep(delayMs);
  }
  return false;
}

async function allocateOne(lytx, webfleet, config) {
  const lytxSel = config.apps.dispatch.selectors;
  const fleetSel = config.apps.fleet.selectors;
  const defaultDriverName = config.defaultDriverName || "Driver Unknown";

  // 1) Lytx: read truck/vehicle number from the table
  await lytx.bringToFront();
  await ensureLytxAssignPage(lytx, config.apps.dispatch);
  const truckNumber = await readFirstVehicle(lytx, lytxSel);

  // No truck number → skip Webfleet and assign Driver Unknown to blank vehicle rows.
  if (!truckNumber) {
    console.log(
      "No truck number on Lytx row — assigning Driver Unknown (skipping Webfleet)."
    );
    const assignResult = await assignDriverInLytx(lytx, lytxSel, defaultDriverName, {
      defaultDriverName,
      emptyVehicleOnly: true,
    });
    return {
      truckNumber: "",
      driverName: assignResult.assignedName,
      usedFallback: true,
      usedDropdownFallback: assignResult.usedDropdownFallback,
      reason: "empty_truck_number",
    };
  }

  // 2) Webfleet Drivers list — skip Sold / LDV / accident (always Driver Unknown).
  // Demo trucks are looked up in Webfleet like normal vehicles.
  let driverName;
  let usedFallback = false;
  let reason = null;

  if (shouldForceDefaultDriver(truckNumber)) {
    driverName = defaultDriverName;
    usedFallback = true;
    reason = "sold_ldv_or_accident";
    console.log(
      `Truck ${truckNumber} marked Sold/LDV/accident — assigning ${driverName} (skipping Webfleet).`
    );
  } else {
    await webfleet.bringToFront();
    await ensureWebfleetMap(webfleet, config.apps.fleet);
    const rawDriverId = await lookupDriverInWebfleet(
      webfleet,
      fleetSel,
      truckNumber
    );
    ({ name: driverName, usedFallback, reason } = resolveDriverName(
      rawDriverId,
      config
    ));
  }

  // 3) Lytx: filter this vehicle, assign driver via modal
  await lytx.bringToFront();
  await filterLytxByVehicle(lytx, lytxSel, truckNumber);
  const assignResult = await assignDriverInLytx(lytx, lytxSel, driverName, {
    defaultDriverName,
    truckNumber,
  });
  await clearLytxVehicleFilter(lytx, lytxSel);

  return {
    truckNumber,
    driverName: assignResult.assignedName,
    usedFallback: usedFallback || assignResult.usedDropdownFallback,
    usedDropdownFallback: assignResult.usedDropdownFallback,
    reason: assignResult.usedDropdownFallback ? "not_in_dropdown" : reason,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
