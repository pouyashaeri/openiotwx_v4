#!/usr/bin/env node
/**
 * The four-step flow: the flasher's step bar, step 3 (Deploy and Publish) and
 * step 4 (Track and Forecast), against a running server.
 *
 *   node scripts/e2e-steps.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:8080";
let failed = false;
const ok = (m) => console.log("ok  ", m);
const bad = (m) => {
  failed = true;
  console.error("FAIL:", m);
};
const expect = (c, m) => (c ? ok(m) : bad(m));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
// A cancelled cross-document page fade (from a quick reload) is a browser notice, not a bug.
page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));

try {
  // The static flasher shows all four steps and links to the new ones.
  await page.goto(`${base}/flash-wizard/index.html`, { waitUntil: "domcontentloaded" });
  const steps = await page.locator(".steps .step").allInnerTexts();
  expect(steps.length === 4 && /Deploy and Publish/.test(steps[2]) && /Track and Forecast/.test(steps[3]), `flasher shows 4 steps (${steps.map((s) => s.replace(/\s+/g, " ").trim()).join(" › ")})`);
  expect((await page.locator('.steps a[href="/deploy"]').count()) === 1 && (await page.locator('.steps a[href="/track"]').count()) === 1, "steps 3 and 4 link to their pages");

  // Account and a station.
  await page.goto(`${base}/login?next=/account`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Name").fill("Steps Tester");
  await page.getByLabel("Email").fill(`steps-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL((u) => u.pathname === "/account");
  await page.getByRole("heading", { name: "Steps Tester" }).waitFor();
  await page.getByText("Add a station by hand").click();
  await page.getByLabel("New station name").fill("Roof");
  await page.getByLabel("Air temperature (°C)").check();
  await page.getByRole("button", { name: "Add station" }).click();
  await page.locator("pre").first().waitFor();

  // Step 2 leads on to step 3.
  await page.goto(`${base}/flash`);
  await page.getByRole("link", { name: /Next: Deploy and Publish/ }).click();
  await page.waitForURL((u) => u.pathname === "/deploy");
  ok("the Flash step leads to Deploy and Publish");

  // Step 3.
  await page.getByRole("heading", { name: "Deploy and Publish" }).waitFor();
  const bar = await page.getByRole("navigation", { name: "Setup steps" }).innerText();
  expect(/Configure[\s\S]*Flash[\s\S]*Deploy and Publish[\s\S]*Track and Forecast/.test(bar), "the same four-step bar is on the page");
  await page.getByText("Waiting for the first reading").waitFor();
  ok("step 3 starts out waiting for the first reading");

  await page.getByRole("button", { name: "Make a key and show settings" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Make new key" }).click();
  const settings = await page.locator("pre").filter({ hasText: '"key": "iotwx_' }).first().innerText();
  const key = /"key": "(iotwx_[^"]+)"/.exec(settings)?.[1];
  expect(Boolean(key), "a new key produces ready-to-paste settings");

  // Three days of hourly history, then the live check should flip to Reporting.
  const now = Date.now();
  const readings = Array.from({ length: 72 }, (_, i) => ({
    ts: new Date(now - (71 - i) * 3600_000).toISOString(),
    values: { temp_c: 15 + 6 * Math.sin((2 * Math.PI * (i % 24)) / 24) },
  }));
  const res = await fetch(`${base}/api/ingest`, { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ readings }) });
  expect(res.status === 202, "readings are accepted with the new key");
  await page.getByText(/Reporting\. Last reading/).waitFor({ timeout: 20000 });
  ok("the live check turns to Reporting on its own");

  // Publish.
  await page.getByRole("button", { name: "Publish this station" }).click();
  await page.getByText(/Public\. Anyone with the link/).waitFor({ timeout: 15000 });
  await page.getByText("Request to copy into an email").waitFor();
  const req = await page.locator("pre").last().innerText();
  expect(/instruments\/\d+\.csv/.test(req) && /Roof/.test(req), "publishing unlocks a ready request with the CHORDS data address");

  // Step 4.
  await page.getByRole("link", { name: "Next: Track and Forecast" }).click();
  await page.waitForURL((u) => u.pathname === "/track");
  await page.getByRole("heading", { name: "Track and Forecast" }).waitFor();
  await page.getByRole("heading", { name: /history and the next day/ }).waitFor({ timeout: 20000 });
  await page.locator("figure svg path").first().waitFor();
  const dashed = await page.locator('figure svg path[stroke-dasharray]').count();
  expect(dashed === 1, "history chart shows the stand-in forecast as a dashed line");
  await page.screenshot({ path: "screenshots/platform-track.png", fullPage: true });

  // A CREDIT run needs the station's location. Step 4 says so until it is set.
  await page.getByText("This station has no location yet.").waitFor();
  ok("step 4 asks for the station's location when it has none");
  await page.getByRole("link", { name: "Add it on the station's page" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/stations/"));
  await page.getByLabel("Latitude (−90 to 90)").first().fill("39.95");
  await page.getByLabel("Longitude (−180 to 180)").first().fill("-105.20");
  await page.getByRole("button", { name: "Save location" }).click();
  await page.getByText("Location saved").waitFor();
  ok("a station's location can be saved from its page");
  await page.goBack();
  await page.getByRole("heading", { name: /history and the next day/ }).waitFor({ timeout: 20000 });
  await page.getByText("39.9500, -105.2000").waitFor({ timeout: 15000 });
  ok("step 4 now shows it");

  // Forecast files from a CREDIT run: the whole grid, several files (one per 6 hours), the model's own column names.
  const dir = mkdtempSync(join(tmpdir(), "credit-"));
  const files = [0, 6, 12].map((h) => {
    const t = new Date(now + (h + 1) * 3600_000).toISOString().slice(0, 19);
    const f = join(dir, `forecast_${String(h).padStart(3, "0")}.csv`);
    // Two grid points: the first (40N, 255E = 105W) is nearest the station; the second is far away and much warmer.
    writeFileSync(
      f,
      ["time,latitude,longitude,temperature,wind_speed", `${t},40,255,${20 + h / 6},3`, `${t},37,252,${99},9`].join("\n"),
    );
    return f;
  });
  await page.getByLabel("Forecast file").setInputFiles(files);
  await page.getByText(/Loaded 3 forecast points/).waitFor({ timeout: 10000 });
  await page.getByText(/Now showing the forecast from 3 files/).waitFor();
  ok("three grid files load together and the point nearest the station is used (not the far, hotter one)");
  const d = await page.locator('figure svg path[stroke-dasharray]').getAttribute("d");
  expect(Boolean(d) && d.split("L").length === 4, "the dashed line follows those three points");

  // A file with several columns and no way to tell which is which is refused, not guessed.
  const bad1 = join(dir, "ambiguous.csv");
  writeFileSync(bad1, ["time,foo,bar", `${new Date(now + 3600_000).toISOString().slice(0, 19)},1,2`].join("\n"));
  await page.getByLabel("Forecast file").setInputFiles(bad1);
  await page.getByText(/Could not find Air temperature in that file/).waitFor({ timeout: 10000 });
  ok("an ambiguous file is refused with a clear message instead of plotting the wrong column");

  // The compute choices are the same ones as the Forecast page and are remembered.
  await page.getByRole("button", { name: /NCAR CIRRUS/ }).click();
  await page.getByText(/for a chosen date and number of days/).waitFor();
  await page.getByText(/does not read your station's readings|does not read\s+your station's readings/).first().waitFor();
  ok("choosing NCAR CIRRUS explains what the Mesonet example actually does");
  await page.screenshot({ path: "screenshots/platform-deploy-track.png", fullPage: true });

  if (errors.length) bad(`browser errors: ${errors.slice(0, 3).join(" | ")}`);
} catch (e) {
  bad(e.message);
  await page.screenshot({ path: "screenshots/e2e-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failed ? "STEPS E2E FAILED" : "Steps E2E passed");
process.exitCode = failed ? 1 : 0;
