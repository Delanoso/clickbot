import { getMailConfig, assertMailConfigured } from "./mail.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const saved = { ...process.env };

try {
  delete process.env.REPORT_EMAIL_TO;
  delete process.env.EMAIL_TO;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;

  let bare = getMailConfig();
  assert(bare.configured === false, "mail should be unconfigured without env");

  let threw = false;
  try {
    assertMailConfigured(bare);
  } catch (error) {
    threw = true;
    assert(/REPORT_EMAIL_TO/.test(error.message), "error lists REPORT_EMAIL_TO");
    assert(/SMTP_HOST/.test(error.message), "error lists SMTP_HOST");
  }
  assert(threw, "assertMailConfigured should throw when incomplete");

  process.env.REPORT_EMAIL_TO = "ops@example.com";
  process.env.SMTP_HOST = "smtp.gmail.com";
  process.env.SMTP_USER = "ops@example.com";
  process.env.SMTP_PASS = "app-password";
  process.env.SMTP_PORT = "587";

  const ready = getMailConfig();
  assert(ready.configured === true, "mail configured when env present");
  assert(ready.to === "ops@example.com", "to address");
  assert(ready.port === 587, "default/explicit port");
  assert(ready.secure === false, "587 is not secure by default");
  assertMailConfigured(ready);

  process.env.SMTP_PORT = "465";
  process.env.SMTP_SECURE = "true";
  const secure = getMailConfig();
  assert(secure.port === 465, "465 port");
  assert(secure.secure === true, "465/secure true");

  console.log("mail tests passed");
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
}
