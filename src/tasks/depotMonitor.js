import { openWebfleetOnly } from "../browser.js";
import {
  ensureWebfleetDepotMonitor,
  lookupTruckAreaInWebfleet,
} from "../apps/webfleet.js";
import {
  formatStatusLine,
  isInTargetArea,
  normalizeMonitorText,
  toAreaTerms,
} from "../utils/depotMonitor.js";

export async function runDepotMonitor(config) {
  const monitor = config.depotMonitor || {};
  const trucks = [
    ...new Set(
      (monitor.trucks || [])
        .map((truck) => String(truck || "").trim())
        .filter(Boolean)
    ),
  ];
  const areaTerms = toAreaTerms(monitor);
  if (!trucks.length) {
    throw new Error("depotMonitor.trucks must contain at least one truck number");
  }
  if (!areaTerms.length) {
    throw new Error("depotMonitor.targetArea or depotMonitor.targetAreas is required");
  }

  const pollIntervalMs = monitor.pollIntervalMs ?? 60000;
  const alertOnInitialMatch = monitor.alertOnInitialMatch ?? true;
  const state = new Map();

  const { browser, page } = await openWebfleetOnly(config);

  try {
    await ensureWebfleetDepotMonitor(page, config.apps.fleet, monitor);

    console.log("Webfleet depot monitor open.");
    console.log(`Watching ${trucks.length} truck(s) for area: ${areaTerms.join(", ")}`);
    console.log(`Polling every ${pollIntervalMs} ms.`);
    console.log("Press Ctrl+C to stop.\n");

    let cycle = 0;
    while (true) {
      cycle += 1;
      console.log(`--- Monitor cycle ${cycle} ---`);

      for (const truckNumber of trucks) {
        const observation = await lookupTruckAreaInWebfleet(
          page,
          config.apps.fleet,
          truckNumber,
          monitor
        );
        const locationText = observation.locationText || "";
        const inTargetArea = isInTargetArea(locationText, monitor);
        const previous = state.get(truckNumber) || null;
        const previousInTargetArea = previous?.inTargetArea ?? false;

        const current = {
          ...observation,
          locationText,
          inTargetArea,
          checkedAt: new Date().toISOString(),
        };
        state.set(truckNumber, current);

        console.log(formatStatusLine(truckNumber, current));

        const shouldAlert =
          inTargetArea &&
          (!previous
            ? alertOnInitialMatch
            : !previousInTargetArea ||
              normalizeMonitorText(previous.locationText) !== normalizeMonitorText(locationText));

        if (shouldAlert) {
          console.log(
            `\u0007ALERT: ${truckNumber} is in target area "${areaTerms[0]}"` +
              (locationText ? ` (${locationText})` : "")
          );
        } else if (previousInTargetArea && !inTargetArea) {
          console.log(
            `INFO: ${truckNumber} left target area` +
              (locationText ? ` (${locationText})` : "")
          );
        }
      }

      console.log("");
      await sleep(pollIntervalMs);
    }
  } finally {
    await browser.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
