import { loadEnvFile } from "./loadEnv.js";
import { loadConfig } from "./config.js";
import { runAllocateDrivers } from "./tasks/allocateDrivers.js";
import { runFyiNotify } from "./tasks/fyiNotify.js";
import { runDueForCoaching } from "./tasks/dueForCoaching.js";
import { runDepotMonitor } from "./tasks/depotMonitor.js";
import { runIncidentsMonitor } from "./tasks/incidentsMonitor.js";
import { runCameraMonitor } from "./tasks/cameraMonitor.js";
import { runWakeTrucks } from "./tasks/wakeTrucks.js";

loadEnvFile();

function parseArgs(argv) {
  const args = { task: "allocate-drivers", configPath: null };
  const rest = [...argv];

  while (rest.length > 0) {
    const token = rest.shift();
    if (token === "--config") {
      args.configPath = rest.shift() || null;
      continue;
    }
    if (token.startsWith("--config=")) {
      args.configPath = token.slice("--config=".length);
      continue;
    }
    if (!token.startsWith("-")) {
      args.task = token;
      continue;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const relaxValidation =
    args.task === "fyi-notify" ||
    args.task === "due-for-coaching" ||
    args.task === "wake-trucks";
  const config = loadConfig({
    configPath: args.configPath,
    relaxValidation,
  });

  switch (args.task) {
    case "allocate-drivers":
      await runAllocateDrivers(config);
      break;
    case "fyi-notify":
      await runFyiNotify(config);
      break;
    case "due-for-coaching":
      await runDueForCoaching(config);
      break;
    case "depot-monitor":
      await runDepotMonitor(config);
      break;
    case "incidents-monitor":
      await runIncidentsMonitor(config);
      break;
    case "camera-monitor":
      await runCameraMonitor(config);
      break;
    case "wake-trucks":
      await runWakeTrucks(config);
      break;
    default:
      console.error(`Unknown task: ${args.task}`);
      console.error(
        "Available tasks: allocate-drivers, fyi-notify, due-for-coaching, depot-monitor, incidents-monitor, camera-monitor, wake-trucks"
      );
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("\nBot failed:");
  console.error(error.message || error);
  process.exitCode = 1;
});
