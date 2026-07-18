/**
 * Sign into an app when login selectors + credentials are configured.
 * Credentials come from environment variables (never from committed config).
 */
export async function maybeLogin(page, appConfig, appName) {
  const login = appConfig.login;
  if (!login?.enabled) {
    return false;
  }

  await dismissCookieBanner(page, login);

  const usernameEnv = login.usernameEnv || "USERNAME";
  const passwordEnv = login.passwordEnv || "PASSWORD";
  const accountEnv = login.accountEnv || null;

  const username = process.env[usernameEnv];
  const password = process.env[passwordEnv];
  const account = accountEnv ? process.env[accountEnv] : null;

  const canAutomate =
    !login.manual &&
    username &&
    password &&
    (!login.accountSelector || account);

  if (!canAutomate) {
    const hints = [usernameEnv, passwordEnv];
    if (login.accountSelector) hints.unshift(accountEnv || "ACCOUNT");
    console.log(
      `[${appName}] Waiting for manual login in the browser...` +
        ` (set ${hints.join("/")} and manual:false to automate)`
    );
    await waitUntilLoggedIn(page, login);
    console.log(`[${appName}] Login detected, continuing.`);
    return true;
  }

  console.log(`[${appName}] Signing in as ${username}...`);

  if (login.accountSelector) {
    await page.locator(login.accountSelector).first().waitFor({ state: "visible" });
    await page.locator(login.accountSelector).first().fill(account);
  }

  await page.locator(login.usernameSelector).first().waitFor({ state: "visible" });
  await page.locator(login.usernameSelector).first().fill(username);
  await page.locator(login.passwordSelector).first().fill(password);

  if (login.rememberMeSelector) {
    const remember = page.locator(login.rememberMeSelector).first();
    if (await remember.count()) {
      await remember.check({ force: true }).catch(() => {});
    }
  }

  await page.locator(login.submitSelector).first().click();
  await waitUntilLoggedIn(page, login);
  console.log(`[${appName}] Signed in.`);
  return true;
}

async function dismissCookieBanner(page, login) {
  const selector = login.cookieAcceptSelector;
  if (!selector) return;

  try {
    const button = page.locator(selector).first();
    await button.waitFor({ state: "visible", timeout: 4000 });
    await button.click();
  } catch {
    // Banner not shown — fine.
  }
}

async function waitUntilLoggedIn(page, login) {
  const timeout = login.timeoutMs ?? 300000;

  if (login.successSelector) {
    await page.locator(login.successSelector).first().waitFor({
      state: "visible",
      timeout,
    });
    return;
  }

  if (!login.successUrlPattern) {
    throw new Error("login.successUrlPattern or login.successSelector is required");
  }

  await page.waitForURL(new RegExp(login.successUrlPattern), { timeout });
}
