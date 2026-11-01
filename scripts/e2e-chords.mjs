#!/usr/bin/env node
/**
 * CHORDS features end to end, against a running server started with
 * CHORDS_ALLOW_PRIVATE=1 (so the importer may read this same server):
 *
 *   CHORDS_ALLOW_PRIVATE=1 npm run dev
 *   node scripts/e2e-chords.mjs [baseUrl]
 *
 * device uploads in CHORDS format → choose/enforce variables → CHORDS-style
 * downloads and listings → import that instrument back as a second station.
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8080";
let failed = false;
const ok = (m) => console.log("ok  ", m);
const bad = (m) => {
  failed = true;
  console.error("FAIL:", m);
};
const expect = (c, m) => (c ? ok(m) : bad(m));
const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 19);
const get = async (path, headers = {}) => {
  const r = await fetch(`${base}${path}`, { headers });
  return { status: r.status, text: await r.text() };
};

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await (await browser.newContext()).newPage();
const errors = [];
// A cancelled cross-document page fade (from a quick reload) is a browser notice, not a bug.
page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));

try {
  // Account + a station created by hand with chosen variables.
  await page.goto(`${base}/login?next=/account`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Name").fill("Chords Tester");
  await page.getByLabel("Email").fill(`chords-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL((u) => u.pathname === "/account");
  await page.getByRole("heading", { name: "Chords Tester" }).waitFor();

  await page.getByText("Add a station by hand").click();
  await page.getByLabel("New station name").fill("Orchard");
  await page.getByLabel("Air temperature (°C)").check();
  await page.getByLabel("Relative humidity (%)").check();
  // A variable that is not in the catalog yet.
  await page.getByRole("button", { name: /Add it/ }).click();
  await page.getByLabel("shortname").fill("leaf_wetness");
  await page.getByLabel("name", { exact: true }).fill("Leaf wetness");
  await page.getByLabel("units").fill("%");
  await page.getByRole("button", { name: "Add variable" }).click();
  await page.getByText("Leaf wetness").first().waitFor();
  ok("a new variable can be added to the catalog and is selected");
  await page.getByRole("button", { name: "Add station" }).click();
  const key = (await page.locator("pre").first().innerText()).trim();
  expect(key.startsWith("iotwx_"), "station registered with its variables");

  await page.getByRole("link", { name: "Orchard" }).first().click();
  await page.getByText(/CHORDS instrument id/).waitFor();
  const instrument = Number(/instrument id (\d+)/.exec(await page.locator("main").innerText())[1]);
  expect(instrument > 0, `station shows its CHORDS instrument id (${instrument})`);

  // CHORDS-format upload.
  const up = (q) => get(`/measurements/url_create?${q}`);
  let r = await up(`instrument_id=${instrument}&temp_c=21.5&humidity_pct=44&api_key=${key}`);
  expect(r.status === 200 && /SAVED/.test(r.text), "url_create saves a measurement");
  r = await up(`instrument_id=${instrument + 99}&temp_c=1&api_key=${key}`);
  expect(r.status === 401, "url_create rejects the wrong instrument id");
  r = await up(`instrument_id=${instrument}&temp_c=1`);
  expect(r.status === 401, "url_create rejects a missing key");
  r = await up(`instrument_id=${instrument}&temp_c=1&test&api_key=${key}`);
  expect(r.status === 200 && /Nothing was stored/.test(r.text), "test uploads are validated, not stored");
  // History for charts/downloads.
  const now = Date.now();
  for (let i = 1; i <= 6; i += 1) {
    const at = new Date(now - i * 600_000).toISOString().slice(0, 19);
    await up(`instrument_id=${instrument}&at=${at}&temp_c=${20 + i / 2}&humidity_pct=${40 + i}&api_key=${key}`);
  }
  await new Promise((res) => setTimeout(res, 2500));

  // Only accept the ticked variables.
  await page.reload();
  await page.getByText(/Variables this station reports/).click();
  await page.getByLabel("Only accept the ticked variables").check();
  await page.getByRole("button", { name: "Save variables" }).click();
  await page.getByText("Saved").first().waitFor();
  await new Promise((res) => setTimeout(res, 31_000)); // key cache TTL: the new rule applies within 30 s
  r = await up(`instrument_id=${instrument}&pm25_ugm3=9&api_key=${key}`);
  expect(r.status === 400 && /only accepts/.test(r.text), "a variable that is switched off is rejected");
  r = await up(`instrument_id=${instrument}&temp_c=22&api_key=${key}`);
  expect(r.status === 200, "a variable that is switched on is still accepted");

  // Private station: closed without the key, open with it.
  r = await get(`/instruments/${instrument}.csv?start=${since}`);
  expect(r.status === 403, "private data is refused without credentials");
  r = await get(`/instruments/${instrument}.csv?start=${since}&api_key=${key}`);
  expect(r.status === 200 && r.text.startsWith("# dataset: GeoCSV 2.0") && /time,humidity_pct,temp_c/.test(r.text), "the station key downloads GeoCSV");
  const rowsCsv = r.text.split("\n").filter((l) => l && !l.startsWith("#")).length - 1;
  expect(rowsCsv >= 7, `CSV has the history (${rowsCsv} rows)`);
  r = await get(`/api/v1/data/${instrument}.json?start=${since}&api_key=${key}`);
  const json = JSON.parse(r.text);
  expect(r.status === 200 && json.data?.length >= 7 && json.variables?.length >= 2, "the newer /api/v1/data path serves JSON with variables");

  // Share it, then it is listed and downloadable by anyone.
  await page.getByRole("button", { name: "Share publicly" }).click();
  await page.getByText("Now shared publicly").waitFor();
  r = await get("/instruments.json");
  expect(JSON.parse(r.text).some((i) => i.id === instrument), "public stations appear in /instruments.json");
  r = await get("/vars.json");
  expect(JSON.parse(r.text).some((v) => v.instrument_id === instrument && v.shortname === "temp_c"), "and their variables in /vars.json");
  r = await get(`/instruments/${instrument}.geojson?start=${since}`);
  expect(r.status === 200 && JSON.parse(r.text).type === "FeatureCollection", "public GeoJSON needs no key");

  // Import the instrument back through the CHORDS importer.
  await page.goto(`${base}/chords`, { waitUntil: "networkidle" });
  await page.getByLabel("Portal address").fill(base);
  await page.getByRole("button", { name: "Show instruments" }).click();
  await page.getByRole("button", { name: /Orchard/ }).first().click();
  await page.getByLabel("Name here").fill("Orchard (imported)");
  await page.getByRole("button", { name: "Import and show it" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/stations/"), { timeout: 30000 });
  await page.getByRole("heading", { name: "Orchard (imported)" }).waitFor();
  await page.getByText("Air temperature").first().waitFor({ timeout: 20000 });
  ok("an instrument imported from a CHORDS portal shows its data");
  await page.locator("figure svg path").first().waitFor();
  ok("and charts it");
  await page.screenshot({ path: "screenshots/platform-chords-import.png", fullPage: true });

  if (errors.length) bad(`browser errors: ${errors.slice(0, 3).join(" | ")}`);
} catch (e) {
  bad(e.message);
  await page.screenshot({ path: "screenshots/e2e-failure.png" }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failed ? "CHORDS E2E FAILED" : "CHORDS E2E passed");
process.exitCode = failed ? 1 : 0;
