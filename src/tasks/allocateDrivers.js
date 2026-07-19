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

/**
 * Task 1: allocate drivers to trucks (Lytx + Webfleet).
 *
 * Flow (one iteration):
 * 1. Lytx Assign Drivers — read first VEHICLE id
 * 2. Webfleet — search vehicle, copy DRIVER name (or "Driver Unknown")
 * 3. Lytx — filter that vehicle, open Assign modal, paste name, confirm
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

  console.log("Lytx + Webfleet open. Starting full driver allocation loop.");
  console.log(maxRuns > 0 ? `maxRuns=${maxRuns}` : "Running until the Assign Drivers queue is empty.");
  console.log("Press Ctrl+C to stop.\n");

  try {
    while (config.loop?.enabled !== false) {
      run += 1;
      if (maxRuns > 0 && run > maxRuns) {
        console.log(`Reached maxRuns (${maxRuns}). Stopping.`);
        break;
      }

      if (!(await hasAssignableRows(lytx, config.apps.dispatch.selectors))) {
        console.log("No more vehicles left in Assign Drivers. Done.");
        break;
      }

      console.log(`--- Run ${run} ---`);
      let result;
      try {
        result = await allocateOne(lytx, webfleet, config);
      } catch (error) {
        if (/empty/i.test(error.message || "")) {
          console.log("Hit an empty vehicle row; checking whether the queue is done...");
          await clearLytxVehicleFilter(lytx, config.apps.dispatch.selectors).catch(() => {});
          if (!(await hasAssignableRows(lytx, config.apps.dispatch.selectors))) {
            console.log("No more vehicles left in Assign Drivers. Done.");
            break;
          }
          console.log(`Skipping empty row and continuing. (${error.message})`);
          continue;
        }
        throw error;
      }

      if (!result.truckNumber) {
        console.log("Empty truck number returned; stopping if queue is clear.");
        if (!(await hasAssignableRows(lytx, config.apps.dispatch.selectors))) {
          console.log("No more vehicles left in Assign Drivers. Done.");
          break;
        }
        continue;
      }

      let suffix = "";
      if (result.reason === "sold_ldv_or_accident") {
        suffix = " (Sold/LDV/accident → Driver Unknown)";
      } else if (result.usedDropdownFallback) {
        suffix = " (fallback: not in Lytx dropdown → Driver Unknown)";
      } else if (result.usedFallback) {
        suffix = ` (fallback: ${result.reason})`;
      }
      console.log(`Truck ${result.truckNumber} -> ${result.driverName}${suffix}`);

      if (result.truckNumber === lastTruck) {
        sameTruckStreak += 1;
      } else {
        sameTruckStreak = 1;
        lastTruck = result.truckNumber;
      }
      if (sameTruckStreak >= 3) {
        console.log(
          `Truck ${result.truckNumber} still at top after ${sameTruckStreak} assigns — forcing page refresh and continuing.`
        );
        await lytx.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        await ensureLytxAssignPage(lytx, config.apps.dispatch);
        sameTruckStreak = 0;
      }

      const delay = config.loop?.delayBetweenRunsMs ?? 2000;
      if (delay > 0) {
        await sleep(delay);
      }
    }
  } finally {
    await browser.close();
  }
}

async function hasAssignableRows(page, selectors) {
  const vehicleColumn =
    selectors.vehicleColumn || ".cdk-row.lytx-table-row .cdk-column-Vehicle";
  const count = await page.locator(vehicleColumn).count();
  return count > 0;
}

async function allocateOne(lytx, webfleet, config) {
  const lytxSel = config.apps.dispatch.selectors;
  const fleetSel = config.apps.fleet.selectors;

  // 1) Lytx: read truck/vehicle number from the table
  await lytx.bringToFront();
  await ensureLytxAssignPage(lytx, config.apps.dispatch);
  const truckNumber = await readFirstVehicle(lytx, lytxSel);
  if (!truckNumber) {
    throw new Error("Vehicle/truck number was empty on the Lytx Assign Drivers table.");
  }

  // 2) Webfleet lookup — skip Sold / LDV / accident (always Driver Unknown).
  // Demo trucks are looked up in Webfleet like normal vehicles.
  let driverName;
  let usedFallback = false;
  let reason = null;

  if (shouldForceDefaultDriver(truckNumber)) {
    driverName = config.defaultDriverName || "Driver Unknown";
    usedFallback = true;
    reason = "sold_ldv_or_accident";
    console.log(
      `Truck ${truckNumber} marked Sold/LDV/accident — assigning ${driverName} (skipping Webfleet).`
    );
  } else {
    await webfleet.bringToFront();
    await ensureWebfleetMap(webfleet, config.apps.fleet);
    const rawDriverName = await lookupDriverInWebfleet(
      webfleet,
      fleetSel,
      truckNumber
    );
    ({ name: driverName, usedFallback, reason } = resolveDriverName(
      rawDriverName,
      config
    ));
  }

  // 3) Lytx: filter this vehicle, assign driver via modal
  await lytx.bringToFront();
  await filterLytxByVehicle(lytx, lytxSel, truckNumber);
  const assignResult = await assignDriverInLytx(lytx, lytxSel, driverName, {
    defaultDriverName: config.defaultDriverName || "Driver Unknown",
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
