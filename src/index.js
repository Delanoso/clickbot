import { loadEnvFile } from "./loadEnv.js";
import { loadConfig } from "./config.js";
import { runAllocateDrivers } from "./tasks/allocateDrivers.js";

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
    if (!token.startsWith("-") && args.task === "allocate-drivers" && token !== "allocate-drivers") {
      // first positional can be the task name
      args.task = token;
      continue;
    }
    if (token === "allocate-drivers") {
      args.task = token;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ configPath: args.configPath });

  switch (args.task) {
    case "allocate-drivers":
      await runAllocateDrivers(config);
      break;
    default:
      console.error(`Unknown task: ${args.task}`);
      console.error("Available tasks: allocate-drivers");
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("\nBot failed:");
  console.error(error.message || error);
  process.exitCode = 1;
});
