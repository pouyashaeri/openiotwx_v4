#!/usr/bin/env node
/**
 * The security promises, checked against a PRODUCTION build on a real Postgres:
 *
 *  - an address listed in SUPERADMIN_EMAILS gets no powers by signing up, and nobody is made an administrator by
 *    being first
 *  - an administrator is made on purpose with scripts/make-admin.mjs, and the role applies after a new sign-in
 *  - a regular account cannot reach /admin
 *  - the Content-Security-Policy blocks outside scripts, and none of the main pages break under it
 *  - password minimum, sign-in rate limit, cross-origin sign-up refused, session cookie flags
 *  - uploads need the station's key, and the token routes refuse without their token
 *  - the old Grok identity header creates no session
 *
 * Run it against a FRESH, UTF-8 database (the first account on it matters), with the server started like this:
 *
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs
 *   npm run build
 *   NODE_ENV=production PORT=8097 HOST=127.0.0.1 DATABASE_URL=postgres://... \
 *     BETTER_AUTH_SECRET=$(openssl rand -base64 48) BETTER_AUTH_URL=http://localhost:8097 \
 *     SUPERADMIN_EMAILS=boss@example.com node .output/server/index.mjs
 *
 *   DATABASE_URL=postgres://... node scripts/e2e-security.mjs http://localhost:8097
 *
 * It signs in more than the sign-in limit allows, so the last step leaves this machine's address rate limited for
 * about a minute. Use localhost in the address (the only origin the server trusts is BETTER_AUTH_URL).
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";

const base = process.argv[2] ?? "http://localhost:8097";
const DB = process.env.DATABASE_URL;
const LISTED = process.env.SECURITY_LISTED_EMAIL ?? "boss@example.com";
if (!DB) {
  console.error("Set DATABASE_URL to the server's database, so the script can run make-admin.mjs.");
  process.exit(2);
}
let bad = false;
const ok = (c, m) => {
  console.log(c ? "ok  " : "FAIL:", m);
  if (!c) bad = true;
};
const PASSWORD = "correct-horse-battery";
const b = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });

async function signUp(ctx, name, email) {
  const page = await ctx.newPage();
  await page.goto(`${base}/login?next=/account`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL("**/account", { timeout: 25000 });
  await page.getByRole("heading", { name }).waitFor();
  return page;
}
const notFound = (page) => page.getByRole("heading", { name: "Page not found" }).isVisible().catch(() => false);
const adminButton = (page) => page.getByRole("link", { name: "Admin panel" });
const makeAdmin = (...args) => spawnSync("node", ["scripts/make-admin.mjs", ...args], { encoding: "utf8", env: { ...process.env, DATABASE_URL: DB } });

try {
  // ── Roles ──────────────────────────────────────────────────────────────────────────────────────
  const bossCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const boss = await signUp(bossCtx, "Boss", LISTED);
  await boss.waitForTimeout(1500);
  ok((await adminButton(boss).count()) === 0, "signing up with a listed super-admin address gives no admin button");
  await boss.goto(`${base}/admin`, { waitUntil: "networkidle" });
  ok(await notFound(boss), "...and /admin is 'Page not found'");

  const plainCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const plain = await signUp(plainCtx, "Plain", `plain-${Date.now()}@example.com`);
  await plain.waitForTimeout(1000);
  ok((await adminButton(plain).count()) === 0, "a second ordinary account has no admin button");

  const made = makeAdmin(LISTED, "superadmin");
  ok(made.status === 0 && /super-admin/.test(made.stdout), "make-admin.mjs promotes the account on the real Postgres");
  const ghost = makeAdmin(`ghost-${Date.now()}@example.com`, "admin");
  ok(ghost.status !== 0 && /sign up/.test(ghost.stdout + ghost.stderr), "...and refuses someone who has not signed up");
  ok(new RegExp(`superadmin\\s+${LISTED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(makeAdmin("--list").stdout), "--list shows the super-admin");

  await boss.goto(`${base}/account`, { waitUntil: "networkidle" });
  ok(new URL(boss.url()).pathname === "/login", "the promoted account's old session was ended");
  await boss.getByLabel("Email").fill(LISTED);
  await boss.getByLabel("Password").fill(PASSWORD);
  await boss.getByRole("button", { name: /^sign in$/i }).click();
  await boss.waitForURL("**/account", { timeout: 25000 });
  await adminButton(boss).waitFor({ timeout: 15000 });
  await adminButton(boss).click();
  await boss.waitForURL("**/admin", { timeout: 15000 });
  await boss.getByText(/Super-admin console/).first().waitFor({ timeout: 15000 });
  ok(true, "after signing in again the account has the Admin panel and /admin opens");

  await plain.goto(`${base}/admin`, { waitUntil: "networkidle" });
  ok(await notFound(plain), "a regular account gets 'Page not found' on /admin");

  // ── Content-Security-Policy ───────────────────────────────────────────────────────────────────
  const walker = await bossCtx.newPage();
  const blocked = [];
  walker.on("console", (m) => /Content Security Policy|Refused to/.test(m.text()) && blocked.push(m.text().slice(0, 230)));
  await walker.goto(base + "/", { waitUntil: "networkidle" });
  await walker.evaluate(() => {
    const s = document.createElement("script");
    s.src = "http://example.com/injected.js";
    document.body.appendChild(s);
  });
  await walker.waitForTimeout(1500);
  ok(blocked.length >= 1, "control: a script from another site is blocked, and the browser reports it (so a clean run below means something)");
  blocked.length = 0;
  const pages = ["/", "/wizard", "/plan", "/map", "/community", "/forecast", "/library", "/analysis", "/gdex", "/contact", "/login", "/account", "/deploy", "/track", "/flash", "/raspberry-pi", "/flash-wizard/index.html", "/flash-wizard/flash.html", "/stations", "/chords", "/admin"];
  for (const p of pages) {
    await walker.goto(base + p, { waitUntil: "load", timeout: 30000 }).catch(() => {});
    await walker.waitForTimeout(1200);
  }
  await walker.goto(base + "/", { waitUntil: "networkidle" });
  await walker.getByRole("button", { name: "Chat to plan your station" }).click();
  await walker.waitForTimeout(2000);
  ok(blocked.length === 0, `no Content-Security-Policy violations across ${pages.length} pages and the chat` + (blocked.length ? "\n      " + [...new Set(blocked)].slice(0, 6).join("\n      ") : ""));
  const headers = (await fetch(base + "/flash-wizard/index.html")).headers;
  ok(["content-security-policy", "x-frame-options", "x-content-type-options", "strict-transport-security", "referrer-policy", "permissions-policy"].every((h) => headers.get(h)), "the security headers are on a static page too");

  // ── Passwords, cookies, uploads, tokens ───────────────────────────────────────────────────────
  const userCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const up = await userCtx.newPage();
  const stamp = Date.now();
  await up.goto(`${base}/login?next=/account`, { waitUntil: "networkidle" });
  await up.getByRole("button", { name: /create an account/i }).click();
  await up.getByLabel("Name").fill("Uploader");
  await up.getByLabel("Email").fill(`uploader-${stamp}@example.com`);
  await up.getByLabel("Password").fill("abc123456");
  await up.getByRole("button", { name: /^create account$/i }).click();
  await up.waitForTimeout(2500);
  ok(new URL(up.url()).pathname === "/login", "a 9-character password is refused at sign-up");
  await up.getByLabel("Password").fill(PASSWORD);
  await up.getByRole("button", { name: /^create account$/i }).click();
  await up.waitForURL("**/account", { timeout: 25000 });
  // The browser stores the cookie a moment after the page changes, so wait for it instead of reading at once.
  let session;
  for (let i = 0; i < 20 && !session; i++) {
    session = (await userCtx.cookies()).find((c) => /session_token/.test(c.name));
    if (!session) await up.waitForTimeout(250);
  }
  ok(Boolean(session) && session.httpOnly && session.secure && session.sameSite === "Lax" && session.name.startsWith("__Host-"), `session cookie: ${session?.name} HttpOnly=${session?.httpOnly} Secure=${session?.secure} SameSite=${session?.sameSite}`);

  await up.getByText("Add a station by hand").click();
  await up.getByLabel("New station name").fill("Security check");
  await up.getByRole("button", { name: "Add station" }).click();
  await up.locator("pre").first().waitFor();
  const key = (await up.locator("pre").first().innerText()).trim();
  const post = (path, headers, body = "{}") => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  ok((await post("/api/ingest", { "x-api-key": key }, JSON.stringify({ values: { temp_c: 21.4 } }))).status === 202, "a station uploads a reading with its own key");
  ok((await post("/api/ingest", { "x-api-key": "iotwx_" + "x".repeat(32) })).status === 401, "a wrong key is refused");
  ok((await post("/api/ingest")).status === 401, "no key is refused");
  ok((await post("/api/ingest/bulk")).status === 403, "the bulk route with no token is refused");
  ok([401, 503].includes((await post("/api/gdex/release")).status), "the GDEX release route with no token is refused");
  const runRequest = await post("/hub/api/forecast-runs/", {}, JSON.stringify({ station_id: 1, backend: "local" }));
  ok(runRequest.status === 401, "asking the hub for a forecast run without signing in is refused: " + runRequest.status);

  const gate = await fetch(`${base}/api/auth/get-session`, { headers: { "x-grok-identity": "eyJhbGciOiJFZERTQSJ9.e30.x", origin: base } });
  const text = await gate.text();
  ok(gate.status === 200 && (text === "null" || text === ""), "the x-grok-identity header creates no session");

  const forged = await post("/api/auth/sign-up/email", { origin: "https://evil.example.org" }, JSON.stringify({ name: "x", email: `forged-${stamp}@example.com`, password: PASSWORD }));
  ok(forged.status === 403, "a sign-up from another origin is refused: " + forged.status);

  // Last: it trips the limiter on purpose.
  const codes = [];
  for (let i = 0; i < 14; i++) {
    codes.push((await post("/api/auth/sign-in/email", { origin: base }, JSON.stringify({ email: LISTED, password: "wrong-password-" + i }))).status);
  }
  ok(codes.includes(429), "sign-in is rate limited: " + codes.join(" "));
} catch (error) {
  ok(false, error.message);
} finally {
  await b.close();
}
console.log(bad ? "SECURITY E2E FAILED" : "Security E2E passed");
process.exitCode = bad ? 1 : 0;
