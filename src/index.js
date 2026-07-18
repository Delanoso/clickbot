import { loadConfig } from "./config.js";
import { runAllocateDrivers } from "./tasks/allocateDrivers.js";

const task = process.argv[2] || "allocate-drivers";

async function main() {
  const config = loadConfig();

  switch (task) {
    case "allocate-drivers":
      await runAllocateDrivers(config);
      break;
    default:
      console.error(`Unknown task: ${task}`);
      console.error("Available tasks: allocate-drivers");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("\nBot failed:");
  console.error(error.message || error);
  process.exitCode = 1;
});
