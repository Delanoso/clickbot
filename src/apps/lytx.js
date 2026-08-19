import {
  clickFrom,
  clickIfPresentFrom,
  clickLocator,
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
        await dismissPendo(page);
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
  // Rows may be empty when the queue is cleared — don't require them here.
  await page
    .locator(selectors.vehicleColumn || ".cdk-row.lytx-table-row .cdk-column-Vehicle")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});
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
 * Read the vehicle/truck ID from the first non-empty data row.
 */
export async function readFirstVehicle(page, selectors) {
  if (selectors.truckNumber) {
    return normalizeVehicle(await readTextFrom(page, selectors.truckNumber));
  }

  const vehicleColumn =
    selectors.vehicleColumn || ".cdk-row.lytx-table-row .cdk-column-Vehicle";
  const cells = page.locator(vehicleColumn);
  const count = await cells.count();
  if (count === 0) {
    return "";
  }

  for (let i = 0; i < count; i += 1) {
    const value = normalizeVehicle(await cells.nth(i).innerText());
    if (value) return value;
  }
  return "";
}

function normalizeVehicle(raw) {
  return String(raw || "")
    .replace(/^Vehicle/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function vehicleMatchesTruck(vehicleText, truckNumber) {
  const vehicle = normalizeVehicle(vehicleText);
  const truck = normalizeVehicle(truckNumber);
  if (!truck) return !vehicle;
  if (vehicle === truck) return true;

  const truckKey = truck.split(/\s+[–—-]\s+|\s+/)[0];
  if (!truckKey) return false;

  return (
    vehicle === truckKey ||
    vehicle.startsWith(`${truckKey} `) ||
    vehicle.startsWith(`${truckKey}-`) ||
    vehicle.startsWith(`${truckKey} –`) ||
    vehicle.startsWith(`${truckKey} —`) ||
    vehicle.includes(truckKey)
  );
}

async function waitForLytxVehicleRows(page, truckNumber, { timeoutMs = 8000, intervalMs = 300 } = {}) {
  const end = Date.now() + timeoutMs;
  const rows = page.locator(".cdk-row.lytx-table-row");
  const vehicleCells = page.locator(".cdk-row.lytx-table-row .cdk-column-Vehicle");

  while (Date.now() < end) {
    const rowCount = await rows.count().catch(() => 0);
    if (rowCount > 0) {
      // Check whether any visible row contains a matching vehicle.
      const cellCount = await vehicleCells.count().catch(() => 0);
      for (let i = 0; i < Math.min(cellCount, rowCount); i += 1) {
        const txt = await vehicleCells.nth(i).innerText().catch(() => "");
        if (vehicleMatchesTruck(txt, truckNumber)) {
          return true;
        }
      }

      // Rows exist but may still be loading; wait more.
    }
    await sleep(intervalMs);
  }

  return false;
}

/**
 * Fallback: remove any active Pendo overlay/backdrop that intercepts pointer events.
 * Pendo is blocked at the browser context level via window.pendo stub (browser.js),
 * but if a cached guide somehow still mounts, this clears it before critical clicks.
 * Only Pendo-owned DOM nodes are touched.
 */
async function dismissPendo(page) {
  try {
    await page.evaluate(() => {
      // Selectors that appear in the "subtree intercepts pointer events" logs.
      const PENDO_SELECTORS = [
        "#pendo-base",
        "._pendo-step-container",
        "._pendo-guide-tt_",
        "[class*='pendo-backdrop']",
        "[id*='pendo-backdrop']",
        ".pendo-mock-flexbox-element",
        "[pendo-region]",
      ];
      for (const sel of PENDO_SELECTORS) {
        document.querySelectorAll(sel).forEach((el) => {
          el.style.setProperty("pointer-events", "none", "important");
          el.style.setProperty("display", "none", "important");
        });
      }
    });
  } catch {
    // Non-fatal — continue even if the page context is transitioning.
  }
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
    // Pendo overlays intercept pointer events and block this click — remove them first.
    await dismissPendo(page);
    await clickLocator(searchDropdown, { timeout: 10000 });
    await sleep(600);
    const vehicleOption = page
      .locator(
        '[data-test-id="common-dropDownList-itemSpan-0"], .dropdown__list__item'
      )
      .filter({ hasText: /Vehicle/i })
      .first();
    await vehicleOption.waitFor({ state: "visible", timeout: 10000 });
    await clickLocator(vehicleOption, { timeout: 10000 });
    await sleep(500);
  }

  const input = page.locator('[data-test-id="typeahead-search-input"], input[placeholder="Search Vehicle Name"]').first();
  await input.waitFor({ state: "visible", timeout: 10000 });
  for (let i = 0; i < 20; i += 1) {
    if (await input.isEnabled()) break;
    await sleep(200);
  }
  await input.fill("");
  // Search by the leading vehicle id token ("H2110" from "H2110 - Sold").
  const searchTerm = String(truckNumber).split(/\s+[–—-]\s+|\s+/)[0];
  await input.fill(searchTerm);
  await sleep(1000);

  const suggestion = page
    .locator("button.dropdown-item, .dropdown-item")
    .filter({
      hasText: new RegExp(
        truckNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      ),
    })
    .first();

  try {
    await suggestion.waitFor({ state: "visible", timeout: 4000 });
    await clickLocator(suggestion, { timeout: 4000 });
  } catch {
    // Prefer exact truck label; otherwise take the first suggestion for the id.
    const fallbackSuggestion = page
      .locator("button.dropdown-item, .dropdown-item")
      .filter({
        hasText: new RegExp(
          searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        ),
      })
      .first();
    try {
      await fallbackSuggestion.waitFor({ state: "visible", timeout: 2000 });
      await clickLocator(fallbackSuggestion, { timeout: 2000 });
    } catch {
      await input.press("Enter");
    }
  }

  if (selectors.vehicleSearchButton) {
    await clickIfPresentFrom(page, selectors.vehicleSearchButton, { timeout: 3000 });
  }

  // Wait until visible rows are only this vehicle (best-effort).
  await waitForLytxVehicleRows(page, truckNumber).catch(() => {});
  // Small buffer for text normalization / final row updates.
  await sleep(500);
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
 * Select visible rows for a specific truck and open the Assign Driver modal.
 * Type the Webfleet No. into Search Name or ID, click the first dropdown suggestion.
 * If there is no suggestion, type "Driver Unknown" and click its first suggestion.
 */
export async function assignDriverInLytx(
  page,
  selectors,
  driverName,
  {
    defaultDriverName = "Driver Unknown",
    truckNumber = null,
    emptyVehicleOnly = false,
  } = {}
) {
  // Custom Lytx checkboxes are <i id="assignDriverCheckbox"> icons, not inputs.
  // Only select rows for this truck — never other vehicles if the filter is leaky.
  // When emptyVehicleOnly, select rows whose VEHICLE cell is blank.
  const rows = page.locator(".cdk-row.lytx-table-row");
  const rowCount = await rows.count();
  let selected = 0;
  for (let i = 0; i < rowCount; i += 1) {
    const row = rows.nth(i);
    const vehicleText = normalizeVehicle(
      await row.locator(".cdk-column-Vehicle").innerText().catch(() => "")
    );
    if (emptyVehicleOnly) {
      if (vehicleText) continue;
    } else if (truckNumber && !vehicleMatchesTruck(vehicleText, truckNumber)) {
      continue;
    }
    const box = row.locator("#assignDriverCheckbox, i.checkbox").first();
    if (!(await box.count())) continue;
    const className = (await box.getAttribute("class")) || "";
    if (/inactive/i.test(className)) {
      await box.click({ force: true });
      selected += 1;
    } else {
      selected += 1; // already selected
    }
  }

  if (selected === 0 && selectors.selectAllCheckbox && !emptyVehicleOnly) {
    await clickIfPresentFrom(page, selectors.selectAllCheckbox, { timeout: 5000 });
  }

  if (selected === 0) {
    // Fall back to first matching row Assign button.
    let rowAssign = null;
    if (emptyVehicleOnly) {
      for (let i = 0; i < rowCount; i += 1) {
        const row = rows.nth(i);
        const vehicleText = normalizeVehicle(
          await row.locator(".cdk-column-Vehicle").innerText().catch(() => "")
        );
        if (vehicleText) continue;
        const btn = row.getByRole("button", { name: "Assign", exact: true }).first();
        if (await btn.isVisible().catch(() => false)) {
          rowAssign = btn;
          break;
        }
      }
    } else if (truckNumber) {
      for (let i = 0; i < rowCount; i += 1) {
        const row = rows.nth(i);
        const vehicleText = normalizeVehicle(
          await row.locator(".cdk-column-Vehicle").innerText().catch(() => "")
        );
        if (!vehicleMatchesTruck(vehicleText, truckNumber)) continue;

        const btn = row
          .locator("button, [role='button'], a")
          .filter({ hasText: /assign/i })
          .first();
        if (await btn.isVisible().catch(() => false)) {
          rowAssign = btn;
          break;
        }
      }
    } else {
      rowAssign = page.getByRole("button", { name: "Assign", exact: true }).first();
    }
    if (rowAssign && (await rowAssign.isVisible().catch(() => false))) {
      await clickLocator(rowAssign, { timeout: 10000 });
    } else {
      const visibleVehicles = [];
      for (let i = 0; i < rowCount; i += 1) {
        const row = rows.nth(i);
        const vehicleText = normalizeVehicle(
          await row.locator(".cdk-column-Vehicle").innerText().catch(() => "")
        );
        if (vehicleText) visibleVehicles.push(vehicleText);
      }
      console.log(
        `[lytx] no selectable rows for ${truckNumber || "(unknown)"}; visible vehicles: ${visibleVehicles
          .slice(0, 10)
          .join(", ")}`
      );
      throw new Error(
        emptyVehicleOnly
          ? "No selectable rows found for empty vehicle number."
          : `No selectable rows found for truck ${truckNumber || "(unknown)"}.`
      );
    }
  } else {
    const batch = page.locator("#batchAssignButton");
    if (
      (await batch.isVisible().catch(() => false)) &&
      (await batch.isEnabled().catch(() => false))
    ) {
      await batch.click();
    } else {
      throw new Error(
        `Selected ${selected} row(s) for ${
          emptyVehicleOnly ? "(empty vehicle)" : truckNumber
        }, but Assign Selected stayed disabled.`
      );
    }
  }

  const inputSel =
    selectors.driverNameInput || { placeholder: "Search Name or ID" };

  let assignedName = driverName;
  let usedDropdownFallback = false;

  const picked = await pickFirstDropdownOption(page, inputSel, driverName);
  if (!picked) {
    assignedName = defaultDriverName;
    usedDropdownFallback =
      driverName.toLowerCase() !== defaultDriverName.toLowerCase();
    const fallbackPicked = await pickFirstDropdownOption(
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

/**
 * Type into Search Name or ID and click the first dropdown suggestion.
 * Lytx often shows the driver name (e.g. GREGORY JOUBERT) when you typed a No. (D3854).
 */
async function pickFirstDropdownOption(page, inputSel, textToType) {
  await fillFrom(page, inputSel, textToType);
  await sleep(400);

  const candidates = page.locator(
    '[role="option"], mat-option, .mat-mdc-option, .mat-option'
  );

  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const option = candidates.nth(i);
    if (!(await option.isVisible().catch(() => false))) continue;
    const label = ((await option.innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!label || /^(cancel|assign)$/i.test(label)) continue;
    await option.click();
    return true;
  }

  // Fallback: first clickable row in the assign overlay.
  const overlayOption = page
    .locator(".cdk-overlay-pane")
    .locator("mat-option, [role='option'], .dropdown-item, button")
    .filter({ hasText: /.+/ })
    .first();
  try {
    await overlayOption.waitFor({ state: "visible", timeout: 3000 });
    const label = ((await overlayOption.innerText().catch(() => "")) || "").trim();
    if (label && !/^(cancel|assign)$/i.test(label)) {
      await overlayOption.click();
      return true;
    }
  } catch {
    // no suggestion
  }

  return false;
}

/**
 * Clear vehicle filter so the next truck can be processed.
 * Lytx keeps a selected vehicle chip after Assign — clearing the text box alone
 * is not enough, and a leftover filter makes the table look empty.
 */
export async function clearLytxVehicleFilter(page, selectors = {}) {
  if (selectors.clearVehicleSearch) {
    await clickIfPresentFrom(page, selectors.clearVehicleSearch, { timeout: 3000 });
  }

  // Remove selected filter chips / typeahead clear icons.
  const removeButtons = page.locator(
    [
      ".mat-mdc-chip-remove",
      ".mat-chip-remove",
      "mat-chip button[aria-label*='remove' i]",
      "mat-chip .mdc-evolution-chip__icon--trailing",
      "[data-test-id*='clear' i]",
      "button[aria-label*='Clear' i]",
      "button[aria-label*='Remove' i]",
      ".typeahead .clear, .search-clear, .clear-icon",
      ".cdk-overlay-pane button.close",
    ].join(", ")
  );
  for (let i = 0; i < 8; i += 1) {
    const btn = removeButtons.first();
    if (!(await btn.isVisible().catch(() => false))) break;
    await btn.click({ force: true }).catch(() => {});
    await sleep(250);
  }

  // Reset filters button when present.
  const reset = page.getByRole("button", { name: /^Reset$/i }).first();
  if (await reset.isVisible().catch(() => false)) {
    await reset.click().catch(() => {});
    await sleep(1000);
  }

  const input = page
    .locator(
      '[data-test-id="typeahead-search-input"], input[placeholder="Search Vehicle Name"]'
    )
    .first();
  if (await input.isVisible().catch(() => false)) {
    try {
      await input.click({ force: true });
      await input.fill("");
      await input.press("Escape").catch(() => {});
      await input.press("Enter").catch(() => {});
    } catch {
      // ignore
    }
  } else if (selectors.vehicleSearchInput) {
    try {
      const configured = locate(page, selectors.vehicleSearchInput);
      await configured.fill("");
      await configured.press("Enter");
    } catch {
      // ignore
    }
  }

  await sleep(1200);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { isOnWorkUrl };
