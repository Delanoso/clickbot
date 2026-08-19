/**
 * Resolve a locator from either a CSS string or a structured descriptor.
 *
 * Examples:
 *   "#truck-number"
 *   { placeholder: "Search" }
 *   { role: "button", name: "Assign Selected" }
 *   { text: "VEHICLES" }
 *   { label: "Name" }
 */
export function locate(page, selector) {
  if (!selector) {
    throw new Error("Missing selector");
  }

  if (typeof selector === "string") {
    return page.locator(selector).first();
  }

  if (selector.placeholder) {
    return page.getByPlaceholder(selector.placeholder, { exact: Boolean(selector.exact) }).first();
  }

  if (selector.role) {
    return page
      .getByRole(selector.role, {
        name: selector.name,
        exact: Boolean(selector.exact),
      })
      .first();
  }

  if (selector.text) {
    return page.getByText(selector.text, { exact: Boolean(selector.exact) }).first();
  }

  if (selector.label) {
    return page.getByLabel(selector.label, { exact: Boolean(selector.exact) }).first();
  }

  if (selector.css) {
    return page.locator(selector.css).first();
  }

  throw new Error(`Unsupported selector: ${JSON.stringify(selector)}`);
}

export async function readTextFrom(page, selector, { timeout = 15000 } = {}) {
  const locator = locate(page, selector);
  await locator.waitFor({ state: "visible", timeout });
  const text = await locator.innerText();
  return text.replace(/\s+/g, " ").trim();
}

export async function fillFrom(page, selector, value, { timeout = 15000 } = {}) {
  const locator = locate(page, selector);
  await locator.waitFor({ state: "visible", timeout });
  await locator.fill("");
  await locator.fill(String(value));
}

/**
 * Robust click helper for cases where Playwright actionability checks
 * are defeated by overlays/animations (e.g. Pendo walkthrough backdrops).
 *
 * Order:
 *  1) normal click
 *  2) force click
 *  3) JS click in page context (bypasses hit-testing)
 */
export async function clickLocator(locator, { timeout = 10000 } = {}) {
  await locator.waitFor({ state: "visible", timeout });

  try {
    await locator.click({ timeout });
    console.log("[clickLocator] click ok (normal)");
    return;
  } catch (error) {
    console.log(
      `[clickLocator] click failed (normal). timeout=${timeout}. error=${String(
        error?.message || error
      )}`
    );
    // First try a force click (bypasses hit-testing). If it still fails,
    // fall back to JS click dispatch in the page context.
    try {
      await locator.click({ timeout, force: true });
      console.log("[clickLocator] click ok (force)");
      return;
    } catch {
      // continue
    }

    // Last resort: bypass Playwright hit-testing entirely.
    // Use JS event dispatch so framework click handlers still receive it.
    try {
      console.log("[clickLocator] click fallback (JS dispatch)");
      await locator.evaluate((el) => {
        if (!(el instanceof Element)) return;

        // Aggressively remove/disable Pendo overlay nodes right before
        // clicking. Some Pendo implementations keep re-rendering, so
        // disabling via styles alone may not be enough.
        const PENDO_NODE_SELECTORS = [
          "#pendo-base",
          "._pendo-step-container",
          "._pendo-guide-tt_",
          ".pendo-mock-flexbox-element",
          ".pendo-backdrop-region-left",
          ".pendo-backdrop-region-right",
          "[class*='pendo-backdrop']",
          "[id*='pendo-backdrop']",
        ];
        for (const sel of PENDO_NODE_SELECTORS) {
          document.querySelectorAll(sel).forEach((node) => {
            try {
              node.remove();
            } catch {
              // ignore
            }
            node.style.setProperty("pointer-events", "none", "important");
            node.style.setProperty("display", "none", "important");
            node.style.setProperty("visibility", "hidden", "important");
          });
        }

        // Dispatch a more realistic click sequence using element coords.
        const r = el.getBoundingClientRect();
        const x = r.left + Math.max(1, r.width / 2);
        const y = r.top + Math.max(1, r.height / 2);

        el.dispatchEvent(
          new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y })
        );
        el.dispatchEvent(
          new MouseEvent("mouseenter", { bubbles: true, clientX: x, clientY: y })
        );
        el.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y })
        );
        el.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y })
        );
        el.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: x, clientY: y })
        );

        // Final nudge.
        try {
          el.click();
        } catch {
          // ignore
        }
      });
      console.log("[clickLocator] click fallback done (JS dispatch)");
      return;
    } catch {
      // If JS click fails, rethrow the original Playwright error.
      throw error;
    }
  }
}

export async function clickFrom(page, selector, { timeout = 10000 } = {}) {
  const locator = locate(page, selector);
  await clickLocator(locator, { timeout });
}

export async function clickIfPresentFrom(page, selector, { timeout = 5000 } = {}) {
  if (!selector) return false;
  try {
    await clickFrom(page, selector, { timeout });
    return true;
  } catch {
    return false;
  }
}
