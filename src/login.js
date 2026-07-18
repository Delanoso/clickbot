/**
 * Sign into an app when login selectors + credentials are configured.
 * Credentials come from environment variables (never from committed config).
 */
export async function maybeLogin(page, appConfig, appName) {
  const login = appConfig.login;
  if (!login?.enabled) {
    return false;
  }

  const usernameEnv = login.usernameEnv || "LYTX_USERNAME";
  const passwordEnv = login.passwordEnv || "LYTX_PASSWORD";
  const username = process.env[usernameEnv];
  const password = process.env[passwordEnv];

  if (login.manual || !username || !password) {
    console.log(
      `[${appName}] Waiting for manual login in the browser...` +
        (!username || !password
          ? ` (set ${usernameEnv}/${passwordEnv} to automate sign-in)`
          : "")
    );
    await waitUntilLoggedIn(page, login);
    console.log(`[${appName}] Login detected, continuing.`);
    return true;
  }

  console.log(`[${appName}] Signing in as ${username}...`);
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

async function waitUntilLoggedIn(page, login) {
  const timeout = login.timeoutMs ?? 300000;

  if (login.successSelector) {
    await page.locator(login.successSelector).first().waitFor({
      state: "visible",
      timeout,
    });
    return;
  }

  const pattern = login.successUrlPattern || "^(?!.*login\\.lytx\\.com).+";
  await page.waitForURL(new RegExp(pattern), { timeout });
}
