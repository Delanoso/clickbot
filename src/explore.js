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
  console.log(`Dispatch URL: ${pages.dispatch.url()}`);
  console.log("Inspect the page, then tell me:");
  console.log("  1) Where the truck number appears (selector or description)");
  console.log("  2) Where to paste the driver name");
  console.log("  3) The second web app URL");
  console.log("\nPress Ctrl+C when finished.\n");

  await new Promise(() => {});
  await browser.close();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
