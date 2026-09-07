import {
  authEnabled,
  createSessionToken,
  getSession,
  resolveRoleFromPassword,
  isGuestApiAllowed,
  isGuestPathAllowed,
  rewriteHtmlForGuest,
  guestNavHtml,
} from "./auth.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fakeReq(cookie = "") {
  return { headers: { cookie } };
}

{
  process.env.ADMIN_PASSWORD = "admin-secret";
  process.env.GUEST_PASSWORD = "guest-secret";
  process.env.SESSION_SECRET = "test-session-secret";

  assert(authEnabled() === true, "auth should be enabled when passwords set");
  assert(resolveRoleFromPassword("admin-secret") === "admin", "admin password");
  assert(resolveRoleFromPassword("guest-secret") === "guest", "guest password");
  assert(resolveRoleFromPassword("wrong") === null, "bad password");

  const token = createSessionToken("guest");
  const session = getSession(fakeReq(`clickbot_session=${encodeURIComponent(token)}`));
  assert(session.role === "guest", "guest session from cookie");

  assert(isGuestPathAllowed("/tracking") === true, "tracking allowed");
  assert(isGuestPathAllowed("/tracking/camera") === true, "camera allowed");
  assert(isGuestPathAllowed("/stale-cameras") === true, "stale allowed");
  assert(isGuestPathAllowed("/wake-trucks") === false, "wake blocked");
  assert(isGuestPathAllowed("/notes") === false, "notes blocked");
  assert(isGuestPathAllowed("/") === true, "home path check returns true (redirect later)");

  assert(isGuestApiAllowed("/api/stale-cameras") === true, "stale api allowed");
  assert(isGuestApiAllowed("/api/tasks/stale-cameras/start") === true, "stale task allowed");
  assert(isGuestApiAllowed("/api/tasks/wake-trucks/start") === false, "wake task blocked");
  assert(isGuestApiAllowed("/api/notes") === false, "notes api blocked");
  assert(isGuestApiAllowed("/api/tasks") === false, "task list blocked");

  const html = `<nav class="top-nav">
        <a class="nav-link" href="/">Home</a>
        <a class="nav-link" href="/tracking">Tracking</a>
        <a class="nav-link" href="/wake-trucks">Wake Trucks</a>
        <a class="nav-link" href="/stale-cameras">Stale Cameras</a>
        <a class="nav-link" href="/notes">Notes</a>
      </nav>`;
  const rewritten = rewriteHtmlForGuest(html, "/tracking");
  assert(!rewritten.includes("Wake Trucks"), "guest html hides wake trucks");
  assert(!rewritten.includes("Notes"), "guest html hides notes");
  assert(!rewritten.includes('href="/"'), "guest html hides home");
  assert(rewritten.includes("/tracking"), "guest html keeps tracking");
  assert(rewritten.includes("/stale-cameras"), "guest html keeps stale cameras");
  assert(guestNavHtml("/stale-cameras").includes("active"), "active nav mark");

  // timing-safe path still rejects tampered tokens
  const bad = getSession(fakeReq(`clickbot_session=${encodeURIComponent(token.slice(0, -2) + "aa")}`));
  assert(bad.role === null, "tampered cookie rejected");

  console.log("auth tests passed");
}
