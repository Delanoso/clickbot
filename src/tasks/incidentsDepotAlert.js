import { runIncidentsMonitor } from "./incidentsMonitor.js";
import { sendMail } from "../utils/mail.js";
import { readTaskStatus, writeTaskStatus } from "../utils/taskStatus.js";

/**
 * Hourly Incident-tracking check:
 * 1) One Webfleet cycle for the incidents list
 * 2) Email if any of those trucks are currently in depot
 *    (skips email when the in-depot set is unchanged since the last alert)
 */
export async function runIncidentsDepotAlert(config) {
  const startedAt = new Date().toISOString();
  const prev = readTaskStatus("incidents-depot-alert") || {};
  const previousIds = new Set(prev.lastAlertTruckIds || []);

  writeTaskStatus("incidents-depot-alert", {
    state: "running",
    message: "Running Incident depot check…",
    startedAt,
    emailSent: false,
  });

  try {
    await runIncidentsMonitor(config, { once: true });
    const snap = readTaskStatus("incidents-monitor") || {};
    const inDepot = [...(snap.inDepot || [])].map((row) => ({
      truckNumber: String(row.truckNumber || "").toUpperCase(),
      locationText: row.locationText || "",
      checkedAt: row.checkedAt || null,
    }));
    const currentIds = inDepot.map((row) => row.truckNumber).filter(Boolean).sort();
    const newlyInDepot = currentIds.filter((id) => !previousIds.has(id));
    const setChanged =
      currentIds.length !== previousIds.size ||
      currentIds.some((id) => !previousIds.has(id));

    if (!currentIds.length) {
      writeTaskStatus("incidents-depot-alert", {
        state: "done",
        message: "No Incident trucks in depot",
        startedAt,
        finishedAt: new Date().toISOString(),
        emailSent: false,
        inDepotCount: 0,
        inDepot: [],
        lastAlertTruckIds: [],
        notification: {
          title: "Incident depot check",
          body: "No trucks from the Incident list are in depot",
          at: new Date().toISOString(),
        },
      });
      console.log("[incidents-depot-alert] No trucks in depot.");
      return { inDepot: [], emailed: false };
    }

    // Email when someone is in depot and the set is new/changed (avoids identical hourly spam).
    if (!setChanged && previousIds.size) {
      writeTaskStatus("incidents-depot-alert", {
        state: "done",
        message: `${currentIds.length} in depot (unchanged — no new email)`,
        startedAt,
        finishedAt: new Date().toISOString(),
        emailSent: false,
        inDepotCount: currentIds.length,
        inDepot,
        lastAlertTruckIds: currentIds,
        newlyInDepot: [],
        notification: {
          title: "Incident depot check",
          body: `${currentIds.length} still in depot; no change since last alert`,
          at: new Date().toISOString(),
        },
      });
      console.log("[incidents-depot-alert] In depot unchanged; skipped email.");
      return { inDepot, emailed: false };
    }

    const when = new Date().toLocaleString("en-ZA", {
      timeZone: "Africa/Johannesburg",
    });
    const subject = newlyInDepot.length
      ? `Incident depot alert — ${newlyInDepot.length} new · ${currentIds.length} total (${when} SAST)`
      : `Incident depot alert — ${currentIds.length} truck(s) in depot (${when} SAST)`;
    const lines = [
      "Incidents tracking found truck(s) currently in depot:",
      "",
      ...inDepot.map(
        (row) =>
          `- ${row.truckNumber}${row.locationText ? ` — ${row.locationText}` : ""}`
      ),
      "",
      newlyInDepot.length
        ? `Newly in depot this check: ${newlyInDepot.join(", ")}`
        : "Depot set changed (arrivals/departures).",
      "",
      "This alert comes from the Incident tracking list only (not PPE / Camera).",
    ];

    const mailResult = await sendMail({
      subject,
      text: lines.join("\n"),
    });

    writeTaskStatus("incidents-depot-alert", {
      state: "done",
      message: `Emailed depot alert to ${mailResult.to}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      emailSent: true,
      emailTo: mailResult.to,
      messageId: mailResult.messageId,
      inDepotCount: currentIds.length,
      inDepot,
      newlyInDepot,
      lastAlertTruckIds: currentIds,
      notification: {
        title: "Incident depot alert",
        body: `${currentIds.length} truck(s) in depot — emailed ${mailResult.to}`,
        at: new Date().toISOString(),
      },
    });

    console.log(
      `[incidents-depot-alert] Email sent to ${mailResult.to}: ${currentIds.join(", ")}`
    );
    return { inDepot, emailed: true, mailResult };
  } catch (error) {
    writeTaskStatus("incidents-depot-alert", {
      state: "error",
      message: error.message || String(error),
      startedAt,
      finishedAt: new Date().toISOString(),
      emailSent: false,
      lastAlertTruckIds: prev.lastAlertTruckIds || [],
      notification: {
        title: "Incident depot alert failed",
        body: error.message || String(error),
        at: new Date().toISOString(),
      },
    });
    throw error;
  }
}
