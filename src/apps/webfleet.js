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

  const opened = await openVehicleRow(page, searchTerm);
  if (!opened) {
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
      // fall through to DOM reader
    }
  }

  // Only the middle DRIVER section. Do NOT fall back to header/list names.
  return readDriverSectionName(page);
}

/**
 * Click the vehicle list row that best matches the truck id (avoid AH2241 for H2241
 * when a better match exists). If Webfleet returns a single filtered result, use it.
 */
async function openVehicleRow(page, searchTerm) {
  const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 1) Exact id at start of label: "TH2239– Name"
  const exact = page.getByText(new RegExp(`^\\s*${escaped}(?![A-Za-z0-9])`, "i")).first();
  try {
    await exact.waitFor({ state: "visible", timeout: 5000 });
    await exact.click();
    return true;
  } catch {
    // continue
  }

  // 2) Id as a prefix of the Webfleet vehicle code: "R2610MH– Name"
  const prefix = page
    .getByText(new RegExp(`^\\s*${escaped}[A-Za-z0-9]*\\b`, "i"))
    .first();
  try {
    await prefix.waitFor({ state: "visible", timeout: 3000 });
    await prefix.click();
    return true;
  } catch {
    // continue
  }

  // 3) Single filtered search hit (e.g. searching H2241 only returns AH2241).
  const singleHit = await page.evaluate((term) => {
    const body = document.body?.innerText || "";
    if (!/\bVEHICLES\s*\(\s*1\s*\//i.test(body)) return null;
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const hit = lines.find((line) => {
      const id = line.split(/[–—-]/)[0].trim();
      return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(id);
    });
    return hit || null;
  }, searchTerm);

  if (singleHit) {
    try {
      await page.getByText(singleHit).first().click({ timeout: 5000 });
      return true;
    } catch {
      // continue
    }
  }

  // 4) Last resort: whole-word contains (may be ambiguous).
  const loose = page.getByText(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i")).first();
  try {
    await loose.waitFor({ state: "visible", timeout: 3000 });
    await loose.click();
    return true;
  } catch {
    return false;
  }
}

/**
 * Read Webfleet details panel: section "DRIVER" → field "Name".
 *
 * Note: the DOM text is often "Driver" while CSS displays "DRIVER".
 */
async function readDriverSectionName(page) {
  try {
    const raw = await page.evaluate(() => {
      const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
      const isDriverHeading = (s) => /^driver$/i.test(normalize(s));

      // 1) Fast path: parse visible page text (CSS may uppercase labels).
      const body = document.body?.innerText || "";
      const bodyMatch = body.match(
        /\bDRIVER\b\s*\n\s*Name\s*\n\s*([^\n]+)\s*\n\s*Cell\b/i
      );
      if (bodyMatch?.[1]) {
        return bodyMatch[1].trim();
      }

      // 2) DOM walk: heading text is often "Driver", not "DRIVER".
      const candidates = [
        ...document.querySelectorAll("div, span, h1, h2, h3, label, strong, p"),
      ];
      const heading =
        candidates.find((el) => {
          const own = [...el.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent || "")
            .join("");
          return isDriverHeading(own) && el.children.length === 0;
        }) ||
        candidates.find((el) => isDriverHeading(el.textContent || ""));

      if (!heading) return "";

      let panel = heading.parentElement;
      for (let i = 0; i < 8 && panel; i += 1) {
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

      const driverIdx = lines.findIndex((line) => /^DRIVER$/i.test(line));
      const start = driverIdx >= 0 ? driverIdx : 0;
      for (let i = start; i < lines.length; i += 1) {
        if (/^Name$/i.test(lines[i]) && lines[i + 1]) {
          const value = lines[i + 1];
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
