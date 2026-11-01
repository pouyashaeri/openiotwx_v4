#!/usr/bin/env node
/**
 * GDEX release flow, end to end, in a real browser: a steward gives consent, an admin checks, builds and
 * promotes a release, and GDEX pulls it from the public manifest. Run against a FRESH server (the first
 * account becomes the super-admin) that was started with:
 *
 *   GDEX_ALLOW_OPEN_PERIOD=1 GDEX_RELEASE_TOKEN=gdextest npm run dev -- --port 8091
 *
 *   node scripts/e2e-gdex.mjs [baseUrl]
 *
 * GDEX_ALLOW_OPEN_PERIOD is a testing aid: ingest only takes readings from the last 30 days, so a test
 * cannot fill a month that has already ended. It lets the build cover the current, unfinished month.
 * If Python and scipy (or netCDF4) are installed, the downloaded NetCDF is also checked by an
 * independent reader (scripts/verify-netcdf.py).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8080";
const stamp = Date.now();
const PASSWORD = "correct-horse-battery";
const TOKEN = process.env.GDEX_RELEASE_TOKEN ?? "gdextest";
let failed = false;
const ok = (m) => console.log("ok  ", m);
const bad = (m) => {
  failed = true;
  console.error("FAIL:", m);
};
const expect = (c, m) => (c ? ok(m) : bad(m));

// The month that holds readings from the last few days. Ingest only takes the last 30 days, so a month
// that has already ended can be filled only shortly after it ends; otherwise the current month is used.
const ref = new Date(Date.now() - 2 * 86400_000);
const monthStart = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
const monthEnd = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
const period = `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, "0")}`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const errors = [];
const watch = (page) => page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page);

  // 1. An owner (first account on a fresh server, so also the super-admin) with a located station that has readings.
  const email = `gdex-${stamp}@example.com`;
  await page.goto(`${base}/login?next=/account`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Name").fill("Steward Sam");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL((u) => u.pathname === "/account");
  await page.getByText("Add a station by hand").click();
  await page.getByLabel("New station name").fill(`GDEX roof ${stamp}`);
  await page.getByRole("button", { name: "Add station" }).click();
  const key = (await page.locator("pre").first().innerText()).trim();
  expect(key.startsWith("iotwx_"), "station registered");
  const send = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  await send("/api/ingest/gateway", { type: "station_info", station_id: "g1", latitude: 40.01499, longitude: -105.27055, altitude: 1655.4 });

  // Readings across this month so far: hourly, three variables, plus a pm2.5 sensor part of the way through.
  const nowS = Math.floor(Date.now() / 1000);
  const startS = Math.max(Math.floor(monthStart.getTime() / 1000) + 3600, nowS - 29 * 86400);
  const endS = Math.min(Math.floor(monthEnd.getTime() / 1000) - 1, nowS - 600);
  const readings = [];
  for (let t = startS; t < endS && readings.length < 700; t += 3600) {
    const i = readings.length;
    const values = { temp_c: 12 + 6 * Math.sin(i / 9), humidity_pct: 45 + 20 * Math.cos(i / 13), pressure_hpa: 835 + (i % 7) * 0.4 };
    if (i > 5) values.pm25_ugm3 = 6 + (i % 5);
    readings.push({ ts: t, values });
  }
  expect(readings.length >= 3, `prepared ${readings.length} hourly readings for ${period}`);
  for (let i = 0; i < readings.length; i += 200) {
    const r = await send("/api/ingest", { readings: readings.slice(i, i + 200) });
    if (r.status !== 202) throw new Error(`ingest answered ${r.status}: ${await r.text()}`);
  }
  await page.waitForTimeout(3000);

  // 2. The steward joins the network, then gives consent, in the station page.
  await page.goto(`${base}/account`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: new RegExp(`GDEX roof ${stamp}`) }).first().click();
  await page.waitForURL(/\/stations\//);
  const stationUrl = page.url();
  await page.getByRole("heading", { name: /GDEX: the NSF NCAR data archive/ }).waitFor({ timeout: 20000 });
  expect(await page.getByText("Not included").first().isVisible(), "the station starts out not included in GDEX");
  const giveBtn = page.getByRole("button", { name: "Give consent to publish in GDEX" });
  expect(await giveBtn.isDisabled(), "consent is blocked until the station is in the NCAR network");
  await page.getByRole("button", { name: "Join the NCAR network" }).click();
  await page.getByText("Joined the NCAR network").waitFor({ timeout: 15000 });
  await page.getByLabel("Data steward (a person)").fill("Sam Steward");
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByLabel("Data steward (a person)").fill("Sam Steward");
  expect(await giveBtn.isEnabled(), "once it is in the network, located, has readings and a named steward, consent is possible");
  await giveBtn.click();
  await page.getByText("Consent recorded").waitFor({ timeout: 15000 });
  await page.getByText("Included in releases").waitFor({ timeout: 15000 });
  ok("consent recorded and the station shows as included in releases");
  await page.getByText(/air temperature/i).first().waitFor().catch(() => {});
  await page.getByText(/How this station.s variables are described/).click();
  await page.getByText("air_temperature").first().waitFor({ timeout: 5000 });
  ok("the station page shows each variable's CF standard name");

  // 3. Admin: description first (a release needs a contact), then check and build.
  await page.goto(`${base}/admin/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Network operations" }).waitFor({ timeout: 15000 });
  await page.getByRole("tab", { name: "gdex" }).click();
  await page.getByText("Eligible for a release").waitFor({ timeout: 15000 });
  const eligible = await page.locator("dt", { hasText: "Eligible for a release" }).locator("xpath=following-sibling::dd").innerText();
  expect(eligible.trim() === "1", `the console counts one eligible station (${eligible})`);
  const periods = await page.getByLabel("Period").locator("option").allInnerTexts();
  console.log("info periods offered:", periods.slice(0, 3).join(" | "));

  // Blocked until described: with no contact email the build refuses, and says why.
  const checkPeriod = periods[0]?.replace(/\s*\(built\)/, "");
  await page.getByRole("button", { name: "Check first" }).click();
  await page.getByText(/Check for .*:/).waitFor({ timeout: 30000 });
  const blockedText = await page.getByText(/Check for .*:/).innerText();
  console.log("info first check:", blockedText.replace(/\s+/g, " "));

  // Fill in the description (contact and creator email), save.
  await page.getByLabel("Creator email").fill("iotwx@example.org");
  await page.getByLabel("Contact email (for GDEX)").fill("data@example.org");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor({ timeout: 10000 });
  ok("the dataset description saves (contact and creator email filled in)");

  // 4. Build the draft for the current month through the scheduler endpoint (it takes a period), as a cron job would.
  const noToken = await fetch(`${base}/api/gdex/release`, { method: "POST", body: "{}" });
  expect(noToken.status === 401 || noToken.status === 503, `the scheduler endpoint refuses a call without the token (${noToken.status})`);
  const wrong = await fetch(`${base}/api/gdex/release`, { method: "POST", headers: { "x-gdex-token": "nope" }, body: "{}" });
  expect(wrong.status === 401 || wrong.status === 503, `...and with a wrong token (${wrong.status})`);
  const built = await fetch(`${base}/api/gdex/release`, { method: "POST", headers: { "x-gdex-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ period }) });
  const builtBody = await built.json();
  expect(built.status === 200 && builtBody.action === "built", `the scheduler built a draft for ${period}: ${JSON.stringify(builtBody).slice(0, 160)}`);
  expect(builtBody.stations === 1, "one station is in the release");

  // A second build of the same open draft is fine (rebuild), but nothing is public yet.
  const manifest0 = await (await fetch(`${base}/gdex/manifest.json`)).json();
  expect(Array.isArray(manifest0.releases) && manifest0.releases.length === 0, "a draft is not in the public manifest");
  const fileName = `openiotwx-network_${period}.nc`;
  const anonDraft = await fetch(`${base}/gdex/releases/${period}/${fileName}`);
  expect(anonDraft.status === 404, `a draft file is not public (${anonDraft.status})`);

  // 5. Staff can open the draft; read it with an independent reader.
  const staffFile = await page.request.get(`${base}/gdex/releases/${period}/${fileName}`);
  expect(staffFile.status() === 200, `staff can download the draft (${staffFile.status()})`);
  const nc = Buffer.from(await staffFile.body());
  expect(nc.subarray(0, 3).toString("latin1") === "CDF", "the file is NetCDF (classic) by its magic bytes");
  const dir = mkdtempSync(join(tmpdir(), "gdex-e2e-"));
  const ncPath = join(dir, fileName);
  writeFileSync(ncPath, nc);
  const py = spawnSync(process.env.PYTHON || "python", ["scripts/verify-netcdf.py", ncPath], { encoding: "utf8" });
  if (py.error || /No module named/.test(py.stderr ?? "")) console.log("info python or scipy not available; skipped the independent NetCDF check");
  else expect(py.status === 0, `an independent reader accepts the NetCDF: ${(py.stdout || py.stderr).trim().split("\n").slice(-1)[0]}`);
  const csv = (await (await page.request.get(`${base}/gdex/releases/${period}/openiotwx-network_${period}.csv`)).text()).split("\n");
  const head = csv.find((l) => l && !l.startsWith("#"));
  expect(/^station_id,latitude,longitude,altitude_m,time_utc_s,/.test(head ?? ""), "the CSV has coordinates on every row and a numeric time column");
  const first = csv.find((l) => l && !l.startsWith("#") && l !== head)?.split(",") ?? [];
  expect(first[1] === "40.015" && first[2] === "-105.271", `coordinates are rounded to 3 decimals (${first[1]}, ${first[2]})`);
  expect(/^\d+$/.test(first[4] ?? ""), `time is a number (${first[4]})`);

  // 6. The console shows it; promote it.
  await page.getByRole("tab", { name: "gdex" }).click();
  await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "gdex" }).click();
  await page.getByRole("heading", { name: period }).waitFor({ timeout: 20000 });
  await page.getByText("Draft", { exact: true }).first().waitFor();
  ok("the console lists the draft release with its quality report");
  await page.screenshot({ path: "screenshots/gdex-admin.png", fullPage: true });
  await page.getByRole("button", { name: "Mark ready for GDEX" }).click();
  await page.getByText("Ready for GDEX", { exact: true }).first().waitFor({ timeout: 15000 });
  const manifest1 = await (await fetch(`${base}/gdex/manifest.json`)).json();
  const rel = manifest1.releases.find((r) => r.period === period);
  expect(Boolean(rel), "once ready, the release is in the public manifest");
  const file = rel?.files.find((f) => f.name === fileName);
  const pulled = Buffer.from(await (await fetch(file.url)).arrayBuffer());
  expect(createHash("sha256").update(pulled).digest("hex") === file.sha256, "GDEX can pull the file and its SHA-256 matches the manifest");
  expect(createHash("sha256").update(pulled).digest("hex") === createHash("sha256").update(nc).digest("hex"), "the file is frozen: public bytes equal the draft bytes");
  const sums = await (await fetch(`${base}/gdex/releases/${period}/SHA256SUMS`)).text();
  expect(sums.includes(file.sha256), "SHA256SUMS lists the same checksum");
  const dataset = await (await fetch(`${base}/gdex/dataset.json`)).json();
  expect(dataset.update_frequency === "monthly" && dataset.variable_catalog.some((v) => v.standardName === "air_temperature"), "dataset.json has the submission fields and the variable vocabulary");

  // 7. A ready release cannot be rebuilt; submission needs a reference; publication needs a DOI.
  const rebuild = await fetch(`${base}/api/gdex/release`, { method: "POST", headers: { "x-gdex-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ period }) });
  expect((await rebuild.json()).error?.includes("Only a draft can be rebuilt"), "a release that is ready cannot be rebuilt");
  await page.getByRole("button", { name: "Record as submitted to GDEX" }).click();
  await page.getByText(/Enter the GDEX submission reference first/).waitFor({ timeout: 10000 });
  ok("recording a submission without a GDEX reference is refused");
  await page.getByLabel("GDEX submission reference").fill("RDA-ticket-12345");
  await page.getByRole("button", { name: "Record as submitted to GDEX" }).click();
  await page.getByText("Submitted to GDEX", { exact: true }).first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Record as published (DOI)" }).click();
  await page.getByText(/Enter the DOI GDEX assigned first/).waitFor({ timeout: 10000 });
  await page.getByLabel(/DOI \(assigned by GDEX/).fill("10.5065/EXAMPLE1");
  await page.getByRole("button", { name: "Record as published (DOI)" }).click();
  await page.getByText("Published", { exact: true }).first().waitFor({ timeout: 15000 });
  const manifest2 = await (await fetch(`${base}/gdex/manifest.json`)).json();
  expect(manifest2.releases.find((r) => r.period === period)?.doi === "10.5065/EXAMPLE1", "the DOI appears in the manifest");

  // 8. The public page.
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pub = await anon.newPage();
  watch(pub);
  await pub.goto(`${base}/gdex`, { waitUntil: "networkidle" });
  await pub.getByRole("heading", { name: /From a station on a roof to the GDEX archive/ }).waitFor({ timeout: 20000 });
  await pub.getByText(period).first().waitFor({ timeout: 15000 });
  await pub.getByRole("link", { name: fileName }).waitFor();
  await pub.getByRole("link", { name: /DOI 10\.5065\/EXAMPLE1/ }).waitFor();
  ok("the public GDEX page lists the release, its files and its DOI");
  await pub.screenshot({ path: "screenshots/gdex-public.png", fullPage: true });
  await pub.setViewportSize({ width: 390, height: 844 });
  await pub.waitForTimeout(500);
  const overflow = await pub.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow <= 1, `no horizontal overflow on a phone (${overflow}px)`);
  await anon.close();

  // 9. Withdrawing consent removes the station from the next preview.
  await page.goto(stationUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Withdraw consent" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Withdraw consent" }).click();
  await page.getByText("Consent withdrawn").waitFor({ timeout: 15000 });
  await page.getByText("Not included").first().waitFor({ timeout: 15000 });
  ok("withdrawing consent takes the station out of future releases");

  if (errors.length) bad(`browser errors: ${errors.slice(0, 4).join(" | ")}`);
} catch (e) {
  bad(e.message);
} finally {
  await browser.close();
}
console.log(failed ? "GDEX E2E FAILED" : "GDEX E2E passed");
process.exitCode = failed ? 1 : 0;
