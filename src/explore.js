import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./loadEnv.js";
import { loadConfig } from "./config.js";
import { openApps } from "./browser.js";

loadEnvFile();

/**
 * Open configured apps (currently Lytx) so you can log in and inspect
 * where the truck number / driver fields live. Does not run the loop.
 */
async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const configPath =
    process.env.CLICKBOT_CONFIG ||
    (existsSync(join(root, "config", "local.json"))
      ? "config/local.json"
      : "config/local.example.json");

  const config = loadConfig({
    configPath,
    relaxValidation: true,
  });

  config.headless = false;

  const { browser, pages } = await openApps(config);
  console.log("\nApps are open.");
  console.log(`Lytx (dispatch): ${pages.dispatch.url()}`);
  console.log(`Webfleet (fleet): ${pages.fleet.url()}`);
  console.log("Log in on both tabs if needed.");
  console.log("Expected work pages after login:");
  console.log("  Lytx:     Assign Drivers");
  console.log("  Webfleet: Map / Vehicles search");
  console.log("\nPress Ctrl+C when finished.\n");

  await new Promise(() => {});
  await browser.close();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
