import { openWebfleetOnly } from "../browser.js";
import {
  ensureWebfleetDepotMonitor,
  lookupTruckAreaInWebfleet,
} from "../apps/webfleet.js";
import { classifyLocation } from "../utils/locationClassifier.js";
import { normalizeMonitorText } from "../utils/depotMonitor.js";
import { writeTaskStatus } from "../utils/taskStatus.js";
import { cameraTruckIds } from "../web/cameraConfig.js";

export async function runCameraMonitor(config) {
  const section = config.cameraWatch || {};
  // Only reuse depot area terms / Webfleet map selectors for location matching —
  // never the PPE/Incident truck lists (cameraWatch.trucks is independent).
  const depotConfig = config.depotMonitor || {};
  const trucks = [...new Set(cameraTruckIds(section.trucks || []))];
  if (!trucks.length) {
    throw new Error("cameraWatch.trucks must contain at least one truck number");
  }

  const pollIntervalMs = section.pollIntervalMs ?? 60000;
  const monitor = {
    workUrl:
      section.workUrl ||
      depotConfig.workUrl ||
      "https://live-wf.webfleet.com/web/map",
    searchDelayMs: section.searchDelayMs ?? depotConfig.searchDelayMs ?? 1500,
    resultDelayMs: section.resultDelayMs ?? depotConfig.resultDelayMs ?? 1000,
    selectors: section.selectors || depotConfig.selectors || {},
  };
  const areaConfig = {
    targetArea: depotConfig.targetArea,
    targetAreas: depotConfig.targetAreas,
  };
  const state = new Map();
  const alerts = [];

  writeTaskStatus("camera-monitor", {
    state: "starting",
    message: "Opening Webfleet",
    watchedCount: trucks.length,
    trucks: [],
    inDepot: [],
    inJohannesburg: [],
    cycle: 0,
  });

  const { browser, page } = await openWebfleetOnly(config);

  try {
    await ensureWebfleetDepotMonitor(page, config.apps.fleet, monitor);

    console.log("Webfleet camera monitor open.");
    console.log(`Watching ${trucks.length} truck(s) for depot + Johannesburg (camera).`);
    console.log(`Polling every ${pollIntervalMs} ms.`);
    console.log("Press Ctrl+C to stop.\n");

    writeTaskStatus("camera-monitor", {
      state: "running",
      message: "Polling Webfleet map",
      watchedCount: trucks.length,
      pollIntervalMs,
      trucks: [],
      inDepot: [],
      inJohannesburg: [],
      cycle: 0,
      alerts,
    });

    let cycle = 0;
    while (true) {
      cycle += 1;
      console.log(`--- Camera cycle ${cycle} ---`);

      for (const truckNumber of trucks) {
        const observation = await lookupTruckAreaInWebfleet(
          page,
          config.apps.fleet,
          truckNumber,
          monitor
        );
        const locationText = observation.locationText || "";
        const zone = classifyLocation(locationText, areaConfig);
        const previous = state.get(truckNumber) || null;

        const current = {
          ...observation,
          locationText,
          zone,
          inDepot: zone === "depot",
          inJohannesburg: zone === "johannesburg",
          checkedAt: new Date().toISOString(),
        };
        state.set(truckNumber, current);

        const tag =
          zone === "depot" ? " [DEPOT]" : zone === "johannesburg" ? " [JHB]" : "";
        console.log(`${truckNumber}: ${locationText || "(no location)"}${tag}`);

        if (
          zone === "johannesburg" &&
          (!previous || previous.zone !== "johannesburg" ||
            normalizeMonitorText(previous.locationText) !==
              normalizeMonitorText(locationText))
        ) {
          const alertText = `${truckNumber} is in Johannesburg` +
            (locationText ? ` (${locationText})` : "");
          console.log(`INFO: ${alertText}`);
          alerts.unshift({
            at: new Date().toISOString(),
            truckNumber,
            locationText,
            zone,
            message: alertText,
          });
          if (alerts.length > 40) alerts.length = 40;
        }

        if (
          zone === "depot" &&
          (!previous || previous.zone !== "depot")
        ) {
          const alertText = `${truckNumber} is in depot` +
            (locationText ? ` (${locationText})` : "");
          console.log(`INFO: ${alertText}`);
          alerts.unshift({
            at: new Date().toISOString(),
            truckNumber,
            locationText,
            zone,
            message: alertText,
          });
          if (alerts.length > 40) alerts.length = 40;
        }

        publishStatus({
          state,
          cycle,
          trucks,
          pollIntervalMs,
          alerts,
          message: `Cycle ${cycle} — checking ${truckNumber}`,
        });
      }

      publishStatus({
        state,
        cycle,
        trucks,
        pollIntervalMs,
        alerts,
        message: `Cycle ${cycle} complete`,
        cycleComplete: true,
      });

      console.log("");
      await sleep(pollIntervalMs);
    }
  } finally {
    const rows = snapshotTrucks(state, trucks);
    writeTaskStatus("camera-monitor", {
      state: "stopped",
      message: "Monitor stopped",
      watchedCount: trucks.length,
      trucks: rows,
      inDepot: rows.filter((row) => row.inDepot),
      inJohannesburg: rows.filter((row) => row.inJohannesburg),
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
      zone: row?.zone || "other",
      inDepot: Boolean(row?.inDepot),
      inJohannesburg: Boolean(row?.inJohannesburg),
      checkedAt: row?.checkedAt || null,
      found: Boolean(row?.found),
    };
  });
}

function publishStatus({
  state,
  cycle,
  trucks,
  pollIntervalMs,
  alerts,
  message,
  cycleComplete = false,
}) {
  const rows = snapshotTrucks(state, trucks);
  const inDepot = rows.filter((row) => row.inDepot);
  const inJohannesburg = rows.filter((row) => row.inJohannesburg);
  writeTaskStatus("camera-monitor", {
    state: "running",
    message,
    watchedCount: trucks.length,
    checkedCount: rows.filter((row) => row.checkedAt).length,
    pollIntervalMs,
    cycle,
    cycleComplete,
    inDepotCount: inDepot.length,
    inJohannesburgCount: inJohannesburg.length,
    trucks: rows,
    inDepot,
    inJohannesburg,
    alerts,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
