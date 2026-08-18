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
    // Use JS dispatch so the UI handlers still receive the click.
    await locator.evaluate((el) => {
      el.click();
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
