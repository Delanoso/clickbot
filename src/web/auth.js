import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "clickbot_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

const GUEST_PAGE_PREFIXES = [
  "/tracking",
  "/stale-cameras",
  "/login",
  "/logout",
  "/styles.css",
];

const GUEST_STATIC_FILES = new Set([
  "/tracking-overview.html",
  "/tracking-ppe.html",
  "/tracking-incident.html",
  "/tracking-camera.html",
  "/tracking-overview.js",
  "/tracking-ppe.js",
  "/tracking-incident.js",
  "/tracking-camera.js",
  "/tracking-shared.js",
  "/stale-cameras.html",
  "/stale-cameras.js",
  "/styles.css",
  "/login.html",
  "/login.js",
  "/nav.js",
]);

const GUEST_API_PREFIXES = [
  "/api/health",
  "/api/me",
  "/api/auth/",
  "/api/tracking",
  "/api/depot",
  "/api/incidents",
  "/api/camera",
  "/api/stale-cameras",
  "/api/tasks/stale-cameras",
];

function env(name) {
  return String(process.env[name] || "").trim();
}

export function authEnabled() {
  return Boolean(env("ADMIN_PASSWORD") || env("GUEST_PASSWORD"));
}

export function sessionSecret() {
  return (
    env("SESSION_SECRET") ||
    env("ADMIN_PASSWORD") ||
    env("GUEST_PASSWORD") ||
    "clickbot-dev-secret"
  );
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.role || !payload?.exp) return null;
    if (Date.now() > payload.exp) return null;
    if (payload.role !== "admin" && payload.role !== "guest") return null;
    return payload;
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function resolveRoleFromPassword(password) {
  const admin = env("ADMIN_PASSWORD");
  const guest = env("GUEST_PASSWORD");
  if (admin && safeEqual(password, admin)) return "admin";
  if (guest && safeEqual(password, guest)) return "guest";
  return null;
}

export function createSessionToken(role) {
  return sign({
    role,
    exp: Date.now() + MAX_AGE_SEC * 1000,
  });
}

export function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function getSession(req) {
  if (!authEnabled()) return { role: "admin", authEnabled: false };
  const cookies = parseCookies(req);
  const payload = verify(cookies[COOKIE_NAME]);
  if (!payload) return { role: null, authEnabled: true };
  return { role: payload.role, authEnabled: true };
}

export function setSessionCookie(res, token) {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

export function isGuestPathAllowed(pathname) {
  const path = pathname.split("?")[0];
  if (GUEST_STATIC_FILES.has(path)) return true;
  if (path === "/" || path === "/index.html") return true; // redirect handled elsewhere
  return GUEST_PAGE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix)
  );
}

export function isGuestApiAllowed(pathname) {
  const path = pathname.split("?")[0];
  return GUEST_API_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(prefix)
  );
}

export function guestNavHtml(activePath = "") {
  const items = [
    { href: "/tracking", label: "Tracking", match: "/tracking" },
    { href: "/stale-cameras", label: "Stale Cameras", match: "/stale-cameras" },
  ];
  return `<nav class="top-nav">${items
    .map((item) => {
      const active =
        activePath === item.match || activePath.startsWith(`${item.match}/`)
          ? " active"
          : "";
      return `<a class="nav-link${active}" href="${item.href}">${item.label}</a>`;
    })
    .join("")}<a class="nav-link" href="/logout">Log out</a></nav>`;
}

/** Rewrite full admin nav in HTML to the guest-only nav. */
export function rewriteHtmlForGuest(html, pathname) {
  let next = html.replace(/<nav class="top-nav">[\s\S]*?<\/nav>/i, guestNavHtml(pathname));
  // Soften page copy that mentions other tools.
  next = next.replace(
    /Run allocate, FYI, and coaching from here\.[^<]*/i,
    "Track trucks and scan stale cameras."
  );
  return next;
}
