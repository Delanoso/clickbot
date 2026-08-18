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

export async function clickFrom(page, selector, { timeout = 10000 } = {}) {
  const locator = locate(page, selector);
  await locator.waitFor({ state: "visible", timeout });
  try {
    await locator.click({ timeout });
  } catch (error) {
    // If another overlay sits on top of the target and intercepts pointer
    // events (common with Pendo guided walkthrough backdrops), Playwright
    // click can never land on the underlying element.
    // Retry with force so the underlying element still receives the click.
    const msg = String(error?.message || "");
    const shouldForce =
      /intercept(s)? pointer events|subtree intercepts pointer events|not stable/i.test(msg);
    if (shouldForce) {
      await locator.click({ timeout, force: true });
      return;
    }
    throw error;
  }
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
