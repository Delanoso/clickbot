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
import { resolveDriverName } from "../utils/driverName.js";

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

  console.log("Lytx + Webfleet open. Starting driver allocation loop.");
  console.log("Press Ctrl+C to stop.\n");

  try {
    while (config.loop?.enabled !== false) {
      run += 1;
      if (maxRuns > 0 && run > maxRuns) {
        console.log(`Reached maxRuns (${maxRuns}). Stopping.`);
        break;
      }

      console.log(`--- Run ${run} ---`);
      const result = await allocateOne(lytx, webfleet, config);
      let suffix = "";
      if (result.usedDropdownFallback) {
        suffix = " (fallback: not in Lytx dropdown → Driver Unknown)";
      } else if (result.usedFallback) {
        suffix = ` (fallback: ${result.reason})`;
      }
      console.log(`Truck ${result.truckNumber} -> ${result.driverName}${suffix}`);

      const delay = config.loop?.delayBetweenRunsMs ?? 2000;
      if (delay > 0) {
        await sleep(delay);
      }
    }
  } finally {
    await browser.close();
  }
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

  // 2) Webfleet: search and copy driver name
  await webfleet.bringToFront();
  await ensureWebfleetMap(webfleet, config.apps.fleet);
  const rawDriverName = await lookupDriverInWebfleet(webfleet, fleetSel, truckNumber);
  const { name: driverName, usedFallback, reason } = resolveDriverName(
    rawDriverName,
    config
  );

  // 3) Lytx: filter this vehicle, assign driver via modal
  await lytx.bringToFront();
  await filterLytxByVehicle(lytx, lytxSel, truckNumber);
  const assignResult = await assignDriverInLytx(lytx, lytxSel, driverName, {
    defaultDriverName: config.defaultDriverName || "Driver Unknown",
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
