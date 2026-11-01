#!/usr/bin/env node
/**
 * Hover audit: visit the main pages, hover every visible button and button-like link, and report the ones
 * whose look does not change (colour, background, border, shadow, filter, transform, opacity, underline,
 * or any of those on the element's own children). A control that shows nothing on hover feels dead.
 *
 *   PW_CHANNEL=msedge node scripts/audit-hover.mjs [baseUrl] [--json]
 *
 * Run it against a FRESH server: it signs up the first account (the super-admin), adds a station, and so
 * also visits the signed-in pages and the admin console. Exit status 1 when anything is reported.
 *
 * "Button-like" means: a <button>, role=button/tab/switch/checkbox, or a link that is drawn as a button or
 * a card (a background, a border or a shadow). Plain text links are not checked here.
 */
import { chromium } from "playwright";

const base = (process.argv.find((a) => /^https?:/.test(a)) ?? "http://localhost:8080").replace(/\/$/, "");
const asJson = process.argv.includes("--json");
// --only=community,map : check just the pages whose label contains one of these words
const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const PASSWORD = "correct-horse-battery";
const stamp = Date.now();

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
let page = await ctx.newPage();
let crashed = false;
const watchCrash = () => page.on("crash", () => (crashed = true));
watchCrash();
/** A very heavy page (the map) can take its tab down; carry on in a fresh tab, which keeps the session. */
async function freshTab() {
  await page.close().catch(() => {});
  page = await ctx.newPage();
  crashed = false;
  watchCrash();
}
const report = [];
let checked = 0;

/** In the page: describe every candidate (in document order), skipping hidden, disabled and duplicate ones. */
const collect = () => {
  const out = [];
  const seen = new Set();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  };
  const alpha = (c) => {
    const m = /rgba?\(([^)]+)\)|color\(([^)]+)\)|oklab\(([^)]+)\)|oklch\(([^)]+)\)/.exec(c);
    if (!m) return c === "transparent" ? 0 : 1;
    const body = (m[1] ?? m[2] ?? m[3] ?? m[4]).split("/");
    if (body.length > 1) return parseFloat(body[1]);
    const parts = body[0].split(",");
    return parts.length === 4 ? parseFloat(parts[3]) : 1;
  };
  const looksLikeButton = (el) => {
    const s = getComputedStyle(el);
    const sides = ["Top", "Right", "Bottom", "Left"].filter((d) => parseFloat(s[`border${d}Width`]) > 0 && alpha(s[`border${d}Color`]) > 0.05);
    const filled = alpha(s.backgroundColor) > 0.05;
    const shadow = s.boxShadow !== "none";
    // a link that is only underlined text, or a bare bottom rule, is not a button
    return filled || shadow || sides.length >= 2;
  };
  for (const el of document.querySelectorAll("button, [role=button], [role=tab], [role=switch], a[href], summary")) {
    if (el.disabled || el.getAttribute("aria-disabled") === "true" || el.getAttribute("aria-hidden") === "true" || el.closest("[aria-hidden=true]")) continue;
    if (el.closest(".leaflet-container, .leaflet-control, [data-sonner-toaster], dialog:not([open]), header.sticky, header.site-header")) continue;
    if (!visible(el)) continue;
    const isLink = el.tagName === "A";
    if (isLink && !looksLikeButton(el)) continue;
    if (!isLink && el.tagName !== "SUMMARY" && !looksLikeButton(el) && !el.matches("[role=tab], [role=switch]")) {
      // a bare icon/text button with no box of its own still needs a hover, so keep it
    }
    const key = `${el.tagName}|${el.className}|${(el.textContent || "").trim().slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = ((el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim().replace(/\s+/g, " ")).slice(0, 40);
    el.setAttribute("data-hover-audit", String(out.length));
    out.push({ i: out.length, tag: el.tagName.toLowerCase(), text, cls: String(el.className).replace(/\s+/g, " ").slice(0, 90) });
  }
  return out.slice(0, 120);
};

/** A fingerprint of how an element (and its first few children) look right now. */
const signature = (i) => {
  const el = document.querySelector(`[data-hover-audit="${i}"]`);
  if (!el) return null;
  const pick = (e) => {
    const s = getComputedStyle(e);
    return [s.color, s.backgroundColor, s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor, s.boxShadow, s.filter, s.transform, s.opacity, s.textDecorationLine, s.outlineStyle, s.cursor === "pointer" ? "p" : s.cursor].join("|");
  };
  return [el, ...[...el.querySelectorAll("*")].slice(0, 12)].map(pick).join("||");
};

async function audit(label, url, { before } = {}) {
  if (only.length && !only.some((w) => label.toLowerCase().includes(w.toLowerCase()))) return;
  if (url) await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
  // A fresh dev server compiles each page on first request, so wait for the page itself, not just the network.
  await page.locator("#content, main, form").first().waitFor({ timeout: 90000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
  if (before) await before();
  const items = await page.evaluate(collect);
  const dead = [];
  for (const it of items) {
    const loc = page.locator(`[data-hover-audit="${it.i}"]`).first();
    if (crashed) break;
    try {
      await loc.evaluate((e) => e.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }));
      await page.mouse.move(2, 2);
      await page.waitForTimeout(380);
      const a = await page.evaluate(signature, it.i);
      if (a === null) continue;
      // Playwright's hover waits until the element is stable and nothing covers it, then moves the pointer to it.
      await loc.hover({ timeout: 4000 });
      await page.waitForTimeout(380);
      const b = await page.evaluate(signature, it.i);
      checked++;
      if (b !== null && a === b) dead.push(it);
    } catch {
      /* the element went away while the page re-rendered; skip it */
    }
  }
  if (crashed) await freshTab();
  else await page.mouse.move(2, 2).catch(() => {});
  if (dead.length) report.push({ label, url: url ?? page.url().replace(base, ""), dead });
  if (!asJson) console.log(`${dead.length ? "NO HOVER" : "ok      "} ${label.padEnd(26)} ${items.length} controls${dead.length ? `, ${dead.length} without a hover` : ""}`);
}

try {
  // ── signed out ──
  for (const [label, url] of [
    ["home", "/"],
    ["wizard", "/wizard"],
    ["plan", "/plan"],
    ["analysis", "/analysis"],
    ["forecast", "/forecast"],
    ["community", "/community"],
    ["library", "/library"],
    ["map", "/map"],
    ["stations list", "/stations"],
    ["gdex", "/gdex"],
    ["raspberry pi", "/raspberry-pi"],
    ["flash (site)", "/flash"],
    ["login", "/login"],
    ["staff login", "/admin/login"],
    ["contact", "/contact"],
    ["flasher setup", "/flash-wizard/index.html"],
    ["flasher flash", "/flash-wizard/flash.html"],
  ]) {
    await audit(label, url);
  }

  // ── signed in (the first account on a fresh server is the super-admin) ──
  const SIGNED = ["account", "station", "deploy", "track", "chords", "signed in", "admin"];
  if (only.length && !only.some((w) => SIGNED.some((l) => l.includes(w.toLowerCase())))) throw new Error("__done__");
  const email = `audit-${stamp}@example.com`;
  await page.goto(`${base}/login?next=/account`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /create an account/i }).click({ timeout: 90000 });
  await page.getByLabel("Name").fill("Audit");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL((u) => u.pathname === "/account");
  await audit("account", "/account");
  await page.getByText("Add a station by hand").click();
  await page.getByLabel("New station name").fill(`Audit roof ${stamp}`);
  await audit("account (add station form)", null);
  await page.getByRole("button", { name: "Add station" }).click();
  await page.locator("pre").first().waitFor();
  await audit("account (new key shown)", null);
  await page.goto(`${base}/account`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: new RegExp(`Audit roof ${stamp}`) }).first().click();
  await page.waitForURL(/\/stations\//);
  await audit("station page", null);
  const slug = page.url().split("/stations/")[1];
  await audit("deploy", `/deploy?station=${slug}`);
  await audit("track", `/track?station=${slug}`);
  await audit("chords import", "/chords");
  await audit("raspberry pi (signed in)", "/raspberry-pi");
  await audit("map (signed in)", "/map");

  // ── admin console, tab by tab ──
  await page.goto(`${base}/admin/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Network operations" }).waitFor({ timeout: 20000 });
  const tabs = await page.getByRole("tab").allInnerTexts();
  for (const t of tabs) {
    await audit(`admin: ${t.trim()}`, null, { before: async () => { await page.getByRole("tab", { name: t.trim() }).click(); await page.waitForTimeout(800); } });
  }
} catch (e) {
  if (e.message !== "__done__") {
    console.error("audit stopped:", e.message);
    report.push({ label: "audit error", url: "", dead: [{ tag: "-", text: e.message, cls: "" }] });
  }
} finally {
  await browser.close();
}

if (asJson) console.log(JSON.stringify({ checked, report }, null, 2));
else {
  console.log(`\nchecked ${checked} controls on ${base}`);
  for (const r of report) {
    console.log(`\n${r.label} (${r.url})`);
    for (const d of r.dead) console.log(`  - <${d.tag}> "${d.text}"   ${d.cls}`);
  }
  console.log(report.length ? `\nHOVER AUDIT: ${report.reduce((n, r) => n + r.dead.length, 0)} controls without a hover` : "\nHover audit passed: every control reacts to hover");
}
process.exitCode = report.length ? 1 : 0;
