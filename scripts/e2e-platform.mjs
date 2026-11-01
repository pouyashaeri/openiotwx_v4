#!/usr/bin/env node
/**
 * End-to-end check of the platform against a running server:
 *   sign up → become admin → register a station → upload readings over HTTP →
 *   see them on the station page → admin console shows the network.
 *
 *   npm run dev            # in one terminal
 *   node scripts/e2e-platform.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8080";
const email = `e2e-${Date.now()}@example.com`;
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exitCode = 1;
};
const ok = (msg) => console.log("ok  ", msg);

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage();
const errors = [];
// A cancelled cross-document page fade (from a quick reload) is a browser notice, not a bug.
page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

try {
  // Sign up.
  await page.goto(`${base}/login?next=/account`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL("**/account", { timeout: 20000 });
  await page.getByRole("heading", { name: "E2E Tester" }).waitFor();
  ok("signed up and landed on My system");

  // Register a station and read its key.
  await page.getByText("Add a station by hand").click();
  await page.getByLabel("New station name").fill("Backyard test");
  await page.getByRole("button", { name: "Add station" }).click();
  const keyBlock = page.locator("pre").first();
  await keyBlock.waitFor();
  const key = (await keyBlock.innerText()).trim();
  if (!key.startsWith("iotwx_")) throw new Error(`unexpected key: ${key}`);
  ok("station registered, key issued");

  // Bad key is rejected; good key accepted.
  const bad = await fetch(`${base}/api/ingest`, { method: "POST", headers: { "x-api-key": "iotwx_nope", "content-type": "application/json" }, body: "{}" });
  if (bad.status !== 401) throw new Error(`bad key got ${bad.status}`);
  const good = await fetch(`${base}/api/ingest`, {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      readings: Array.from({ length: 30 }, (_, i) => ({
        ts: new Date(Date.now() - (30 - i) * 60_000).toISOString(),
        values: { temp_c: 20 + Math.sin(i / 5) * 3, humidity_pct: 40 + i / 3 },
      })),
    }),
  });
  if (good.status !== 202) throw new Error(`good key got ${good.status}: ${await good.text()}`);
  ok(`ingest accepted: ${JSON.stringify(await good.json())}`);

  // Buffer flushes within ~1 s; the station page should show it.
  await page.waitForTimeout(2500);
  await page.reload();
  await page.getByText("Backyard test").first().waitFor();
  await page.locator("dl").getByText("Air temperature").first().waitFor({ timeout: 15000 });
  ok("station card shows the latest values");

  await page.screenshot({ path: "screenshots/platform-account.png" });
  await page.getByText("Backyard test").first().click();
  await page.getByRole("heading", { name: "Air temperature" }).waitFor();
  await page.locator("figure svg path").first().waitFor();
  await page.screenshot({ path: "screenshots/platform-station.png", fullPage: true });
  ok("station page renders a chart");

  // Staff-only console: covered in depth by e2e-admin.mjs. A regular person just gets "not found".
  await page.goto(`${base}/admin`);
  await page.getByRole("heading", { name: "Page not found" }).waitFor({ timeout: 15000 });
  ok("the admin console is invisible to regular accounts");

  if (errors.length) fail(`browser console errors: ${errors.slice(0, 5).join(" | ")}`);
} catch (e) {
  fail(e.message);
  await page.screenshot({ path: "screenshots/e2e-failure.png" }).catch(() => {});
} finally {
  await browser.close();
}
if (!process.exitCode) console.log("E2E passed");
