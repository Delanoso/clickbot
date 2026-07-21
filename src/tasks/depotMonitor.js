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
import { writeTaskStatus } from "../utils/taskStatus.js";

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
  const alerts = [];

  writeTaskStatus("depot-monitor", {
    state: "starting",
    message: "Opening Webfleet",
    watchedCount: trucks.length,
    areaTerms,
    trucks: [],
    inDepot: [],
    cycle: 0,
  });

  const { browser, page } = await openWebfleetOnly(config);

  try {
    await ensureWebfleetDepotMonitor(page, config.apps.fleet, monitor);

    console.log("Webfleet depot monitor open.");
    console.log(`Watching ${trucks.length} truck(s) for area: ${areaTerms.join(", ")}`);
    console.log(`Polling every ${pollIntervalMs} ms.`);
    console.log("Press Ctrl+C to stop.\n");

    writeTaskStatus("depot-monitor", {
      state: "running",
      message: "Polling Webfleet map",
      watchedCount: trucks.length,
      areaTerms,
      pollIntervalMs,
      trucks: [],
      inDepot: [],
      cycle: 0,
      alerts,
    });

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
              normalizeMonitorText(previous.locationText) !==
                normalizeMonitorText(locationText));

        if (shouldAlert) {
          const alertText =
            `${truckNumber} is in target area "${areaTerms[0]}"` +
            (locationText ? ` (${locationText})` : "");
          console.log(`\u0007ALERT: ${alertText}`);
          alerts.unshift({
            at: new Date().toISOString(),
            truckNumber,
            locationText,
            message: alertText,
          });
          if (alerts.length > 30) alerts.length = 30;
        } else if (previousInTargetArea && !inTargetArea) {
          console.log(
            `INFO: ${truckNumber} left target area` +
              (locationText ? ` (${locationText})` : "")
          );
        }

        publishDepotStatus({
          state,
          cycle,
          trucks,
          areaTerms,
          pollIntervalMs,
          alerts,
          message: `Cycle ${cycle} — checking ${truckNumber}`,
        });
      }

      publishDepotStatus({
        state,
        cycle,
        trucks,
        areaTerms,
        pollIntervalMs,
        alerts,
        message: `Cycle ${cycle} complete`,
        cycleComplete: true,
      });

      console.log("");
      await sleep(pollIntervalMs);
    }
  } finally {
    writeTaskStatus("depot-monitor", {
      state: "stopped",
      message: "Monitor stopped",
      watchedCount: trucks.length,
      areaTerms,
      trucks: snapshotTrucks(state, trucks),
      inDepot: snapshotTrucks(state, trucks).filter((row) => row.inTargetArea),
      cycle: 0,
      alerts,
    });
    await browser.close();
  }
}

function snapshotTrucks(state, trucks) {
  return trucks.map((truckNumber) => {
    const row = state.get(truckNumber);
    return {
      truckNumber,
      locationText: row?.locationText || "",
      inTargetArea: Boolean(row?.inTargetArea),
      checkedAt: row?.checkedAt || null,
      found: Boolean(row?.found),
    };
  });
}

function publishDepotStatus({
  state,
  cycle,
  trucks,
  areaTerms,
  pollIntervalMs,
  alerts,
  message,
  cycleComplete = false,
}) {
  const rows = snapshotTrucks(state, trucks);
  const inDepot = rows.filter((row) => row.inTargetArea);
  writeTaskStatus("depot-monitor", {
    state: "running",
    message,
    watchedCount: trucks.length,
    checkedCount: rows.filter((row) => row.checkedAt).length,
    areaTerms,
    pollIntervalMs,
    cycle,
    cycleComplete,
    inDepotCount: inDepot.length,
    trucks: rows,
    inDepot,
    alerts,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
