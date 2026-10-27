import nodemailer from "nodemailer";

/**
 * Build SMTP mail options from env.
 * Required: SMTP_HOST, SMTP_USER, SMTP_PASS, REPORT_EMAIL_TO (or EMAIL_TO)
 * Optional: SMTP_PORT (587), SMTP_SECURE (false), SMTP_FROM, REPORT_EMAIL_FROM
 */
export function getMailConfig() {
  const to = String(process.env.REPORT_EMAIL_TO || process.env.EMAIL_TO || "").trim();
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const from =
    String(process.env.REPORT_EMAIL_FROM || process.env.SMTP_FROM || user || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

  return {
    to,
    from: from || to,
    host,
    port,
    secure,
    user,
    pass,
    configured: Boolean(to && host && user && pass),
  };
}

export function assertMailConfigured(config = getMailConfig()) {
  if (config.configured) return config;
  const missing = [];
  if (!config.to) missing.push("REPORT_EMAIL_TO");
  if (!config.host) missing.push("SMTP_HOST");
  if (!config.user) missing.push("SMTP_USER");
  if (!config.pass) missing.push("SMTP_PASS");
  throw new Error(
    `Email is not configured. Set ${missing.join(", ")} in .env (Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, use an App Password).`
  );
}

export async function sendMail({
  to,
  subject,
  text,
  html,
  attachments = [],
} = {}) {
  const config = assertMailConfigured();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const info = await transporter.sendMail({
    from: config.from,
    to: to || config.to,
    subject,
    text,
    html,
    attachments,
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    to: to || config.to,
  };
}
