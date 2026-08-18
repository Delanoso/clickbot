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
    return;
  } catch (error) {
    const msg = String(error?.message || "");
    const shouldForce =
      /intercept(s)? pointer events|subtree intercepts pointer events|not stable/i.test(
        msg
      );

    if (shouldForce) {
      try {
        await locator.click({ timeout, force: true });
        return;
      } catch (error2) {
        // Fall through to JS click below.
        // (We keep the original error semantics if JS click fails too.)
        const forceMsg = String(error2?.message || "");
        if (!/intercept(s)? pointer events|subtree intercepts pointer events|not stable/i.test(forceMsg)) {
          throw error;
        }
      }
    }

    // Last resort: bypass Playwright hit-testing entirely.
    // Use JS event dispatch so framework click handlers still receive it.
    await locator.evaluate((el) => {
      if (!(el instanceof Element)) return;

      // Re-neutralize Pendo immediately before clicking. This covers cases
      // where Pendo mounts after the init script or in a different timing.
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
          node.style.setProperty("pointer-events", "none", "important");
          node.style.setProperty("display", "none", "important");
          node.style.setProperty("visibility", "hidden", "important");
        });
      }

      // Dispatch a more realistic click sequence (mousedown/mouseup/click)
      // with coordinates, which is sometimes required for Angular/Material
      // dropdowns.
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

      // Also call the native click() as a final nudge.
      try {
        el.click();
      } catch {
        // ignore
      }
    });
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
