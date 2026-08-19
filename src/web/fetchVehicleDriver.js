import { openWebfleetOnly } from "../browser.js";
import { lookupVehicleDriverInWebfleet } from "../apps/webfleet.js";
import { cleanDriverName } from "../utils/driverName.js";
import { loadConfig } from "../config.js";

/**
 * Open Webfleet Vehicles, search truck No., return cleaned Driver column name.
 */
export async function fetchVehicleDriverName(truckNumber, configPath = "config/local.json") {
  const config = loadConfig({ configPath, relaxValidation: true });
  const { browser, page } = await openWebfleetOnly(config);
  try {
    const raw = await lookupVehicleDriverInWebfleet(
      page,
      config.apps.fleet?.selectors || {},
      truckNumber
    );
    const driver = cleanDriverName(raw);
    if (!driver || /^(no driver|n\/a|na|none|unknown|-|--)$/i.test(driver)) {
      return "";
    }
    return driver;
  } finally {
    await browser.close();
  }
}
