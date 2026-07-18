import {
  clickIfPresent,
  fillInput,
  openApps,
  readText,
} from "../browser.js";
import { resolveDriverName } from "../utils/driverName.js";

/**
 * Task 1: allocate drivers to trucks across two web apps.
 *
 * Flow (one iteration):
 * 1. Read truck number from the dispatch app
 * 2. Search that truck in the fleet app
 * 3. Copy the driver name (or fall back to "Driver Unknown")
 * 4. Paste the name into the dispatch app and continue
 */
export async function runAllocateDrivers(config) {
  const { browser, pages } = await openApps(config);
  const { dispatch, fleet } = pages;
  const dispatchSel = config.apps.dispatch.selectors;
  const fleetSel = config.apps.fleet.selectors;

  const maxRuns = config.loop?.maxRuns ?? 0;
  let run = 0;

  console.log("Both apps open. Starting driver allocation loop.");
  console.log("Press Ctrl+C to stop.\n");

  try {
    while (config.loop?.enabled !== false) {
      run += 1;
      if (maxRuns > 0 && run > maxRuns) {
        console.log(`Reached maxRuns (${maxRuns}). Stopping.`);
        break;
      }

      console.log(`--- Run ${run} ---`);
      const result = await allocateOne(dispatch, fleet, dispatchSel, fleetSel, config);
      console.log(
        `Truck ${result.truckNumber} -> ${result.driverName}` +
          (result.usedFallback ? ` (fallback: ${result.reason})` : "")
      );

      if (config.loop?.enabled === false) {
        break;
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

async function allocateOne(dispatch, fleet, dispatchSel, fleetSel, config) {
  // 1) Dispatch app: read truck number (fixed location)
  await dispatch.bringToFront();
  const truckNumber = await readText(dispatch, dispatchSel.truckNumber);
  if (!truckNumber) {
    throw new Error("Truck number was empty. Check apps.dispatch.selectors.truckNumber.");
  }

  // 2) Fleet app: search truck and copy driver details
  await fleet.bringToFront();
  await fillInput(fleet, fleetSel.searchInput, truckNumber);

  if (fleetSel.searchButton) {
    await clickIfPresent(fleet, fleetSel.searchButton);
  } else {
    await fleet.locator(fleetSel.searchInput).first().press("Enter");
  }

  if (fleetSel.resultReady) {
    await fleet.locator(fleetSel.resultReady).first().waitFor({
      state: "visible",
      timeout: 15000,
    });
  }

  let rawDriverName = "";
  try {
    rawDriverName = await readText(fleet, fleetSel.driverNameResult, {
      timeout: 10000,
    });
  } catch {
    rawDriverName = "";
  }

  const { name: driverName, usedFallback, reason } = resolveDriverName(
    rawDriverName,
    config
  );

  // 3) Dispatch app: paste driver name (or default)
  await dispatch.bringToFront();
  await fillInput(dispatch, dispatchSel.driverNameInput, driverName);

  if (dispatchSel.submitButton) {
    await clickIfPresent(dispatch, dispatchSel.submitButton);
  }

  // Optional: advance to the next truck for the next loop iteration
  if (dispatchSel.nextItemButton) {
    await clickIfPresent(dispatch, dispatchSel.nextItemButton);
  }

  return { truckNumber, driverName, usedFallback, reason };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
