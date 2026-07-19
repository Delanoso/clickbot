import {
  clickFrom,
  clickIfPresentFrom,
  fillFrom,
  locate,
  readTextFrom,
} from "../locate.js";

/**
 * Lytx Assign Drivers page helpers.
 * Work URL: https://app.lytx.com/#/driver-safety/tasks/assigndriver
 */
export async function ensureLytxAssignPage(page, appConfig) {
  const workUrl = appConfig.workUrl;
  if (!workUrl) return;

  if (!isOnWorkUrl(page.url(), workUrl)) {
    await page.goto(workUrl, { waitUntil: "domcontentloaded" });
  }

  const heading = locate(page, appConfig.selectors.pageReady || { text: "ASSIGN DRIVERS" });
  await heading.waitFor({ state: "visible", timeout: 60000 });
}

function isOnWorkUrl(currentUrl, workUrl) {
  if (!workUrl) return true;
  if (currentUrl === workUrl) return true;

  try {
    const current = new URL(currentUrl);
    const work = new URL(workUrl);
    if (current.origin !== work.origin) return false;
    if (current.pathname.replace(/\/$/, "") !== work.pathname.replace(/\/$/, "")) {
      return false;
    }
    if (!work.hash) return true;
    return current.hash === work.hash || currentUrl.includes(work.hash.slice(1));
  } catch {
    return currentUrl.includes(workUrl);
  }
}

/**
 * Read the vehicle/truck ID from the first data row in the Assign Drivers table.
 */
export async function readFirstVehicle(page, selectors) {
  if (selectors.truckNumber) {
    return readTextFrom(page, selectors.truckNumber);
  }

  // Prefer an explicit first-row vehicle cell when provided.
  if (selectors.firstVehicleCell) {
    return readTextFrom(page, selectors.firstVehicleCell);
  }

  // Fallback: first body cell under a VEHICLE header-style layout used in demos/real UI.
  const cell = page.locator("table tbody tr").first().locator("td").nth(selectors.vehicleColumnIndex ?? 2);
  await cell.waitFor({ state: "visible", timeout: 20000 });
  return (await cell.innerText()).replace(/\s+/g, " ").trim();
}

/**
 * Filter the Assign Drivers list to one vehicle (bulk-assign that truck's events).
 */
export async function filterLytxByVehicle(page, selectors, truckNumber) {
  if (selectors.vehicleSearchType) {
    await clickIfPresentFrom(page, selectors.vehicleSearchType, { timeout: 5000 });
    await clickIfPresentFrom(page, selectors.vehicleSearchTypeOption || { text: "Vehicle" }, {
      timeout: 5000,
    });
  }

  if (!selectors.vehicleSearchInput) {
    return;
  }

  await fillFrom(page, selectors.vehicleSearchInput, truckNumber);

  // Prefer an autocomplete panel suggestion; avoid clicking the table cell with the same text.
  const suggestion = page
    .locator('[role="listbox"] *, [role="option"], .cdk-overlay-pane *, .mat-mdc-option')
    .filter({ hasText: new RegExp(`^${truckNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })
    .first();

  try {
    await suggestion.waitFor({ state: "visible", timeout: 2500 });
    await suggestion.click();
  } catch {
    await locate(page, selectors.vehicleSearchInput).press("Enter");
  }

  if (selectors.vehicleSearchButton) {
    await clickIfPresentFrom(page, selectors.vehicleSearchButton, { timeout: 3000 });
  }

  await sleep(800);
}

/**
 * Select visible rows and open the Assign Driver modal, then paste the driver name.
 */
export async function assignDriverInLytx(page, selectors, driverName) {
  // Select all visible rows when a header/select-all checkbox is configured.
  if (selectors.selectAllCheckbox) {
    await clickIfPresentFrom(page, selectors.selectAllCheckbox, { timeout: 5000 });
  }

  const opened =
    (await clickIfPresentFrom(page, selectors.assignSelectedButton || { role: "button", name: "Assign Selected" }, {
      timeout: 5000,
    })) ||
    (await clickIfPresentFrom(page, selectors.rowAssignButton || { role: "button", name: "Assign", exact: true }, {
      timeout: 5000,
    }));

  if (!opened) {
    throw new Error("Could not open Assign Driver modal (Assign Selected / Assign).");
  }

  const inputSel =
    selectors.driverNameInput || { placeholder: "Search Name or ID" };
  await fillFrom(page, inputSel, driverName);

  // Choose matching suggestion when Lytx offers one (e.g. "SIPHA KHANYI | DT3862").
  const suggestion = page
    .locator('[role="option"], [role="listbox"] *, mat-option, .mat-mdc-option')
    .filter({ hasText: new RegExp(driverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
    .first();

  try {
    await suggestion.waitFor({ state: "visible", timeout: 4000 });
    await suggestion.click();
  } catch {
    // Driver Unknown (or exact typed name) may not have a suggestion.
  }

  const confirm =
    selectors.assignConfirmButton || { role: "button", name: "Assign", exact: true };

  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    if (typeof confirm === "string" || confirm.css || confirm.placeholder) {
      await clickFrom(page, confirm);
    } else {
      await dialog
        .getByRole(confirm.role || "button", {
          name: confirm.name || "Assign",
          exact: Boolean(confirm.exact ?? true),
        })
        .first()
        .click();
    }
  } else {
    await clickFrom(page, confirm);
  }

  // Wait for modal to close.
  try {
    await locate(page, inputSel).waitFor({ state: "hidden", timeout: 15000 });
  } catch {
    // Some builds keep the field briefly; continue.
  }
}

/**
 * Clear vehicle filter so the next truck can be processed.
 */
export async function clearLytxVehicleFilter(page, selectors) {
  if (selectors.clearVehicleSearch) {
    await clickIfPresentFrom(page, selectors.clearVehicleSearch, { timeout: 3000 });
    return;
  }

  if (selectors.vehicleSearchInput) {
    const input = locate(page, selectors.vehicleSearchInput);
    try {
      await input.fill("");
      await input.press("Enter");
    } catch {
      // ignore
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
