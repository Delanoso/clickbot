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
  const selectors = appConfig.selectors || {};

  // Deep links often bounce to the dashboard — open Assign Drivers from the tile.
  if (!isOnAssignDrivers(page.url())) {
    if (workUrl && !page.url().includes("app.lytx.com")) {
      await page.goto(workUrl, { waitUntil: "domcontentloaded" });
    }

    if (!isOnAssignDrivers(page.url())) {
      const tile =
        selectors.openAssignTile || { text: "UNASSIGNED DRIVERS" };
      try {
        await locate(page, tile).waitFor({ state: "visible", timeout: 90000 });
        await clickFrom(page, tile);
        await page.waitForURL(/assigndriver/, { timeout: 60000 });
      } catch {
        if (workUrl) {
          await page.goto(workUrl, { waitUntil: "domcontentloaded" });
        }
      }
    }
  }

  const heading = locate(page, selectors.pageReady || { text: "ASSIGN DRIVERS" });
  await heading.waitFor({ state: "visible", timeout: 60000 });
  await page
    .locator(selectors.vehicleColumn || ".cdk-row.lytx-table-row .cdk-column-Vehicle")
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
}

function isOnAssignDrivers(url) {
  return /assigndriver/i.test(url);
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
    return normalizeVehicle(await readTextFrom(page, selectors.truckNumber));
  }

  const vehicleColumn =
    selectors.vehicleColumn || ".cdk-row.lytx-table-row .cdk-column-Vehicle";
  const cell = page.locator(vehicleColumn).first();
  await cell.waitFor({ state: "visible", timeout: 20000 });
  return normalizeVehicle(await cell.innerText());
}

function normalizeVehicle(raw) {
  return String(raw || "")
    .replace(/^Vehicle/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filter the Assign Drivers list to one vehicle (bulk-assign that truck's events).
 */
export async function filterLytxByVehicle(page, selectors, truckNumber) {
  // Open "Select Search" dropdown and choose Vehicle (skip if already Vehicle).
  const searchDropdown = page
    .locator('[data-test-id="dropdown-select-span"]')
    .filter({ hasText: /Select Search|Vehicle/i })
    .first();
  const current = ((await searchDropdown.innerText().catch(() => "")) || "").trim();
  if (!/^Vehicle$/i.test(current)) {
    await searchDropdown.click();
    await sleep(600);
    const vehicleOption = page
      .locator(
        '[data-test-id="common-dropDownList-itemSpan-0"], .dropdown__list__item'
      )
      .filter({ hasText: /Vehicle/i })
      .first();
    await vehicleOption.waitFor({ state: "visible", timeout: 10000 });
    await vehicleOption.click();
    await sleep(500);
  }

  const input = page.locator('[data-test-id="typeahead-search-input"], input[placeholder="Search Vehicle Name"]').first();
  await input.waitFor({ state: "visible", timeout: 10000 });
  for (let i = 0; i < 20; i += 1) {
    if (await input.isEnabled()) break;
    await sleep(200);
  }
  await input.fill("");
  await input.fill(String(truckNumber));
  await sleep(1000);

  const suggestion = page
    .locator("button.dropdown-item, .dropdown-item")
    .filter({
      hasText: new RegExp(
        `^\\s*${truckNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
        "i"
      ),
    })
    .first();

  try {
    await suggestion.waitFor({ state: "visible", timeout: 4000 });
    await suggestion.click();
  } catch {
    await input.press("Enter");
  }

  if (selectors.vehicleSearchButton) {
    await clickIfPresentFrom(page, selectors.vehicleSearchButton, { timeout: 3000 });
  }

  // Wait until visible rows are only this vehicle (best-effort).
  await sleep(1500);
  const vehicles = await page
    .locator(".cdk-row.lytx-table-row .cdk-column-Vehicle")
    .allTextContents();
  const normalized = vehicles.map((v) =>
    String(v).replace(/^Vehicle/i, "").trim()
  );
  if (normalized.length && !normalized.every((v) => v === truckNumber)) {
    console.log(
      `[lytx] warning: filter may be incomplete for ${truckNumber}: ${normalized
        .slice(0, 5)
        .join(", ")}`
    );
  }
}

/**
 * Select visible rows and open the Assign Driver modal, then paste the driver name.
 * If the looked-up name is not in the Lytx dropdown, assign "Driver Unknown" instead.
 */
export async function assignDriverInLytx(
  page,
  selectors,
  driverName,
  { defaultDriverName = "Driver Unknown" } = {}
) {
  // Custom Lytx checkboxes are <i id="assignDriverCheckbox"> icons, not inputs.
  const boxes = page.locator("#assignDriverCheckbox, i.lx-checkbox-inactive");
  const boxCount = await boxes.count();
  if (boxCount > 0) {
    for (let i = 0; i < boxCount; i += 1) {
      const box = boxes.nth(i);
      const className = (await box.getAttribute("class")) || "";
      if (/inactive/i.test(className) && (await box.isVisible().catch(() => false))) {
        await box.click({ force: true });
      }
    }
    await sleep(300);
  } else if (selectors.selectAllCheckbox) {
    await clickIfPresentFrom(page, selectors.selectAllCheckbox, { timeout: 5000 });
  }

  const batch = page.locator("#batchAssignButton");
  let opened = false;
  if (await batch.isVisible().catch(() => false)) {
    if (await batch.isEnabled().catch(() => false)) {
      await batch.click();
      opened = true;
    }
  }

  if (!opened) {
    opened =
      (await clickIfPresentFrom(
        page,
        selectors.assignSelectedButton || { role: "button", name: "Assign Selected" },
        { timeout: 3000 }
      )) ||
      (await clickIfPresentFrom(
        page,
        selectors.rowAssignButton || { role: "button", name: "Assign", exact: true },
        { timeout: 5000 }
      ));
  }

  if (!opened) {
    throw new Error("Could not open Assign Driver modal (Assign Selected / Assign).");
  }

  const inputSel =
    selectors.driverNameInput || { placeholder: "Search Name or ID" };

  let assignedName = driverName;
  let usedDropdownFallback = false;

  const picked = await pickDriverFromDropdown(page, inputSel, driverName);
  if (!picked) {
    assignedName = defaultDriverName;
    usedDropdownFallback =
      driverName.toLowerCase() !== defaultDriverName.toLowerCase();
    const fallbackPicked = await pickDriverFromDropdown(
      page,
      inputSel,
      defaultDriverName
    );
    if (!fallbackPicked) {
      throw new Error(
        `Could not select "${defaultDriverName}" from the Lytx Assign Driver dropdown.`
      );
    }
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
    // Modal may not expose dialog role — click the enabled Assign in the modal footer.
    const modalAssign = page
      .locator("button")
      .filter({ hasText: /^Assign$/ })
      .last();
    await modalAssign.click();
  }

  try {
    await locate(page, inputSel).waitFor({ state: "hidden", timeout: 15000 });
  } catch {
    // continue
  }

  return { assignedName, usedDropdownFallback };
}

async function pickDriverFromDropdown(page, inputSel, driverName) {
  await fillFrom(page, inputSel, driverName);

  const escaped = driverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suggestion = page
    .locator(
      '[role="option"], [role="listbox"] *, mat-option, .mat-mdc-option, .cdk-overlay-pane *'
    )
    .filter({ hasText: new RegExp(escaped, "i") })
    .first();

  try {
    await suggestion.waitFor({ state: "visible", timeout: 4000 });
    await suggestion.click();
    return true;
  } catch {
    return false;
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

  // Reset filters button when present.
  const reset = page.getByRole("button", { name: /^Reset$/i }).first();
  if (await reset.isVisible().catch(() => false)) {
    await reset.click();
    await sleep(1000);
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

export { isOnWorkUrl };
