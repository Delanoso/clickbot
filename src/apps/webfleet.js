import { clickIfPresentFrom, locate } from "../locate.js";
import { cleanDriverName } from "../utils/driverName.js";

/**
 * Webfleet map page helpers.
 * Work URL: https://live-wf.webfleet.com/web/map
 */
export async function ensureWebfleetMap(page, appConfig) {
  const workUrl = appConfig.workUrl || "https://live-wf.webfleet.com/web/map";
  if (!/live-wf\.webfleet\.com\/web\/map/i.test(page.url())) {
    await page.goto(workUrl, { waitUntil: "domcontentloaded" });
  }
  await page.getByText(/VEHICLES/i).first().waitFor({ timeout: 60000 }).catch(() => {});
}

/**
 * Search a truck and return ONLY the name from the middle DRIVER → Name section.
 * Never use the header/list name under the truck number (e.g. "DRIVER" / "Phillip Mofokeng").
 */
export async function lookupDriverInWebfleet(page, selectors, truckNumber) {
  if (selectors.vehiclesTab) {
    await clickIfPresentFrom(page, selectors.vehiclesTab, { timeout: 8000 });
  } else {
    await clickIfPresentFrom(page, { text: "VEHICLES" }, { timeout: 5000 });
  }

  const search = await resolveSearchInput(page, selectors);
  await search.fill("", { force: true });
  const searchTerm = String(truckNumber).split(/\s+[–—-]\s+|\s+/)[0];
  await search.fill(searchTerm, { force: true });
  await search.press("Enter");
  await sleep(1500);

  // Open the vehicle details panel from the list.
  const row = page
    .getByText(new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
    .first();
  try {
    await row.waitFor({ state: "visible", timeout: 8000 });
    await row.click();
  } catch {
    return "";
  }

  await sleep(1200);

  // Explicit config selector for DRIVER → Name, if provided.
  if (selectors.driverNameResult) {
    try {
      const raw = await locate(page, selectors.driverNameResult).innerText({
        timeout: 8000,
      });
      return cleanDriverName(raw);
    } catch {
      return "";
    }
  }

  // Only the middle DRIVER section. Do NOT fall back to header/list names.
  return readDriverSectionName(page);
}

/**
 * Read Webfleet details panel: section "DRIVER" → field "Name".
 */
async function readDriverSectionName(page) {
  try {
    const raw = await page.evaluate(() => {
      const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();

      // Find a visible heading whose text is exactly DRIVER.
      const candidates = [...document.querySelectorAll("div, span, h1, h2, h3, label, strong, p")];
      const heading = candidates.find((el) => {
        const text = normalize(el.childNodes.length ? el.textContent : "");
        // Prefer short nodes that are exactly "DRIVER" (section title).
        return text === "DRIVER" && el.children.length === 0;
      }) || candidates.find((el) => normalize(el.textContent) === "DRIVER");

      if (!heading) return "";

      // Walk up to a reasonable panel container, then locate Name → value.
      let panel = heading.parentElement;
      for (let i = 0; i < 6 && panel; i += 1) {
        const text = panel.innerText || "";
        if (/Name/i.test(text) && /Cell/i.test(text)) break;
        panel = panel.parentElement;
      }
      if (!panel) panel = heading.parentElement;
      if (!panel) return "";

      const lines = panel.innerText
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      // Expected shape near: DRIVER, Name, <value>, Cell, <phone>
      const driverIdx = lines.findIndex((line) => /^DRIVER$/i.test(line));
      const start = driverIdx >= 0 ? driverIdx : 0;
      for (let i = start; i < lines.length; i += 1) {
        if (/^Name$/i.test(lines[i]) && lines[i + 1]) {
          const value = lines[i + 1];
          // Stop if we hit another label.
          if (/^(Cell|Details|Position|DRIVER)$/i.test(value)) return "";
          return value;
        }
      }
      return "";
    });

    return cleanDriverName(raw);
  } catch {
    return "";
  }
}

async function resolveSearchInput(page, selectors) {
  if (selectors.searchInput) {
    const locator = locate(page, selectors.searchInput);
    try {
      await locator.waitFor({ state: "visible", timeout: 5000 });
      return locator;
    } catch {
      // continue
    }
  }

  const candidates = page.locator('input[type="search"], input[placeholder="Search"]');
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  const forced = candidates.nth(Math.max(0, count - 1));
  await forced.waitFor({ state: "attached", timeout: 10000 });
  return forced;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
