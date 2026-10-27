import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runIncidentsMonitor } from "./incidentsMonitor.js";
import { runCameraMonitor } from "./cameraMonitor.js";
import {
  buildTrackingExportExcelHtml,
  trackingExportFilename,
} from "../web/trackingExport.js";
import { getMailConfig, sendMail } from "../utils/mail.js";
import { readTaskStatus, runtimeDir, writeTaskStatus } from "../utils/taskStatus.js";

/**
 * One-shot automation:
 * 1) Run Driver Incident tracking for one cycle
 * 2) Run Truck Camera tracking for one cycle
 * 3) Build both Excel exports
 * 4) Optionally email them (default on) and mark the report task done
 */
export async function runTrackingReport(
  config,
  { configPath = "config/local.json", email = true } = {}
) {
  const startedAt = new Date().toISOString();
  writeTaskStatus("tracking-report", {
    state: "running",
    message: email
      ? "Starting incident + camera one-cycle report"
      : "Starting incident + camera one-cycle report (no email)",
    startedAt,
    emailSent: false,
    emailEnabled: Boolean(email),
  });

  try {
    writeTaskStatus("tracking-report", {
      state: "running",
      message: "Running Driver Incident one cycle…",
      startedAt,
      step: "incidents",
    });
    console.log("[tracking-report] Incident monitor — one cycle");
    await runIncidentsMonitor(config, { once: true });

    writeTaskStatus("tracking-report", {
      state: "running",
      message: "Running Truck Camera one cycle…",
      startedAt,
      step: "camera",
    });
    console.log("[tracking-report] Camera monitor — one cycle");
    await runCameraMonitor(config, { once: true });

    writeTaskStatus("tracking-report", {
      state: "running",
      message: "Building Excel exports…",
      startedAt,
      step: "export",
    });

    const incidentName = trackingExportFilename("incident", { excel: true });
    const cameraName = trackingExportFilename("camera", { excel: true });
    const incidentHtml = buildTrackingExportExcelHtml("incident", configPath);
    const cameraHtml = buildTrackingExportExcelHtml("camera", configPath);

    const outDir = join(runtimeDir, "reports");
    mkdirSync(outDir, { recursive: true });
    const incidentPath = join(outDir, incidentName);
    const cameraPath = join(outDir, cameraName);
    writeFileSync(incidentPath, incidentHtml, "utf8");
    writeFileSync(cameraPath, cameraHtml, "utf8");

    const incidentSnap = readTaskStatus("incidents-monitor") || {};
    const cameraSnap = readTaskStatus("camera-monitor") || {};
    const summary = {
      incidentTrucks: incidentSnap.watchedCount || incidentSnap.trucks?.length || 0,
      incidentInDepot: incidentSnap.inDepotCount ?? incidentSnap.inDepot?.length ?? 0,
      incidentInJhb:
        incidentSnap.inJohannesburgCount ?? incidentSnap.inJohannesburg?.length ?? 0,
      cameraTrucks: cameraSnap.watchedCount || cameraSnap.trucks?.length || 0,
      cameraInDepot: cameraSnap.inDepotCount ?? cameraSnap.inDepot?.length ?? 0,
      cameraInJhb:
        cameraSnap.inJohannesburgCount ?? cameraSnap.inJohannesburg?.length ?? 0,
      incidentFile: incidentName,
      cameraFile: cameraName,
      incidentPath,
      cameraPath,
    };

    const finishedAt = new Date().toISOString();
    console.log("[tracking-report] Saved:", incidentPath);
    console.log("[tracking-report] Saved:", cameraPath);

    if (!email) {
      writeTaskStatus("tracking-report", {
        state: "done",
        message: `Report saved (no email) — ${incidentName}, ${cameraName}`,
        startedAt,
        finishedAt,
        emailSent: false,
        emailEnabled: false,
        summary,
        notification: {
          title: "Tracking report ready",
          body: `Saved without email: ${incidentName}, ${cameraName}`,
          at: finishedAt,
        },
      });
      console.log("[tracking-report] Done (no email).");
      return { summary, mailResult: null, mailConfigured: getMailConfig().configured };
    }

    writeTaskStatus("tracking-report", {
      state: "running",
      message: "Emailing Excel exports…",
      startedAt,
      step: "email",
      summary,
    });

    const mailCfg = getMailConfig();
    const subject = `Tracking report ready — Incident + Truck Camera (${new Date().toLocaleString(
      "en-ZA",
      { timeZone: "Africa/Johannesburg" }
    )} SAST)`;
    const text = [
      "Clickbot tracking report is ready.",
      "",
      `Driver Incident: ${summary.incidentTrucks} trucks · ${summary.incidentInDepot} depot · ${summary.incidentInJhb} Johannesburg`,
      `Truck Camera: ${summary.cameraTrucks} trucks · ${summary.cameraInDepot} depot · ${summary.cameraInJhb} Johannesburg`,
      "",
      "Attached Excel files:",
      `- ${incidentName}`,
      `- ${cameraName}`,
      "",
      "This is your completion notification for the automated one-cycle run.",
    ].join("\n");

    const mailResult = await sendMail({
      subject,
      text,
      attachments: [
        {
          filename: incidentName,
          content: incidentHtml,
          contentType: "application/vnd.ms-excel; charset=utf-8",
        },
        {
          filename: cameraName,
          content: cameraHtml,
          contentType: "application/vnd.ms-excel; charset=utf-8",
        },
      ],
    });

    writeTaskStatus("tracking-report", {
      state: "done",
      message: `Report emailed to ${mailResult.to}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      emailSent: true,
      emailEnabled: true,
      emailTo: mailResult.to,
      messageId: mailResult.messageId,
      summary,
      notification: {
        title: "Tracking report ready",
        body: `Excel files emailed to ${mailResult.to}`,
        at: new Date().toISOString(),
      },
    });

    console.log("[tracking-report] Email sent:", mailResult.to, mailResult.messageId);
    console.log("[tracking-report] Done.");
    return { summary, mailResult, mailConfigured: mailCfg.configured };
  } catch (error) {
    writeTaskStatus("tracking-report", {
      state: "error",
      message: error.message || String(error),
      startedAt,
      finishedAt: new Date().toISOString(),
      emailSent: false,
      notification: {
        title: "Tracking report failed",
        body: error.message || String(error),
        at: new Date().toISOString(),
      },
    });
    throw error;
  }
}
