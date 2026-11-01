#!/usr/bin/env node
/**
 * The network map, the NCAR opt-in, the legacy gateway input, the "right now" summary and the
 * admin database console. Run against a FRESH server (the first account becomes super-admin):
 *
 *   node scripts/e2e-map.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8080";
const stamp = Date.now();
const PASSWORD = "correct-horse-battery";
let failed = false;
const ok = (m) => console.log("ok  ", m);
const bad = (m) => {
  failed = true;
  console.error("FAIL:", m);
};
const expect = (c, m) => (c ? ok(m) : bad(m));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const errors = [];
const watch = (page) => {
  page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));
};

async function signUp(page, email, name) {
  await page.goto(`${base}/login?next=/account`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL((u) => u.pathname === "/account");
  await page.getByRole("heading", { name }).waitFor();
}

async function addStation(page, name) {
  await page.goto(`${base}/account`, { waitUntil: "networkidle" });
  await page.getByText("Add a station by hand").click();
  await page.getByLabel("New station name").fill(name);
  await page.getByRole("button", { name: "Add station" }).click();
  const key = (await page.locator("pre").first().innerText()).trim();
  // The one-time key notice also mentions the name, so open the station from a fresh list.
  await page.goto(`${base}/account`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await page.waitForURL(/\/stations\//);
  return key;
}

try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  watch(page);
  const owner = `owner-${stamp}@example.com`;
  await signUp(page, owner, "Owner");

  const NAME = `Rooftop ${stamp}`;
  const key = await addStation(page, NAME);
  const stationUrl = page.url();
  expect(key.startsWith("iotwx_"), "station registered");

  // No location yet: joining the NCAR network is not offered.
  await page.getByRole("heading", { name: "NCAR research network" }).waitFor();
  expect(await page.getByRole("button", { name: "Join the NCAR network" }).isDisabled(), "joining needs a location first");

  // The legacy gateway reports its position and readings in its own format.
  const send = (body) =>
    fetch(`${base}/api/ingest/gateway`, { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  const pos = await send({ type: "station_info", station_id: "pi-1", latitude: 40.015, longitude: -105.27, altitude: 1650 });
  expect(pos.status === 202, `position packet accepted (${pos.status})`);
  const now = Math.floor(Date.now() / 1000);
  const rd = await send([
    { station_id: "pi-1", sensor: "bme680", measurement: "temperature", reading_value: "22.5", timestamp: now },
    { station_id: "pi-1", sensor: "bme680", measurement: "relative_humidity", reading_value: "41", timestamp: now },
    { station_id: "pi-1", sensor: "ws302", measurement: "ws", reading_value: "0.1", timestamp: now },
    { station_id: "pi-1", sensor: "mrt_calculated", measurement: "mrt", reading_value: "27.3", timestamp: now },
    { type: "keep_alive", station_id: "pi-1" },
  ]);
  const rb = await rd.json();
  expect(rd.status === 202 && rb.accepted === 4 && rb.skipped === 1, `gateway readings accepted ${JSON.stringify(rb)}`);
  expect((await fetch(`${base}/api/ingest/gateway`, { method: "POST", headers: { "x-api-key": "iotwx_nope", "content-type": "application/json" }, body: "[]" })).status === 401, "bad key refused on the gateway route");

  await page.waitForTimeout(2500);
  await page.goto(stationUrl, { waitUntil: "networkidle" });
  await page.getByText("40.015, -105.270").first().waitFor({ timeout: 15000 });
  ok("the device's own position placed the station");
  await page.getByText("Right now:").waitFor({ timeout: 15000 });
  const summary = await page.getByLabel("Conditions right now").innerText();
  expect(/mild at 22\.5/.test(summary) && /Mean radiant temperature is 27\.3/.test(summary), `summary reads the device data: ${summary.replace(/\s+/g, " ")}`);
  await page.getByText("Mean radiant temperature").first().waitFor();
  ok("legacy metric names get readable labels");

  // Private: not on the signed-out map. Then join the NCAR network.
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  watch(pub);
  await pub.goto(`${base}/map`, { waitUntil: "networkidle" });
  await pub.locator(".leaflet-container").waitFor({ timeout: 20000 });
  await pub.getByLabel("Find a station").fill(NAME);
  await pub.waitForTimeout(500);
  expect((await pub.getByRole("list", { name: "Stations on the map" }).getByText(NAME).count()) === 0, "a private station is not on the public map");

  await page.getByRole("button", { name: "Join the NCAR network" }).click();
  await page.getByText("Joined the NCAR network").waitFor({ timeout: 15000 });
  await page.getByText(/Shared publicly/).waitFor();
  ok("joined the NCAR network (and became public)");

  await pub.reload({ waitUntil: "networkidle" });
  await pub.locator(".leaflet-container").waitFor();
  await pub.getByLabel("Find a station").fill(NAME);
  await pub.getByRole("list", { name: "Stations on the map" }).getByText(NAME).waitFor({ timeout: 25000 });
  ok("the shared station is on the public map");
  await pub.locator(".leaflet-marker-icon").first().waitFor({ timeout: 15000 });
  expect((await pub.getByText("NCAR network", { exact: true }).first().isVisible()), "network counters show");
  await pub.getByRole("button", { name: "NCAR network", exact: true }).click();
  await pub.getByRole("list", { name: "Stations on the map" }).getByText(NAME).waitFor();
  ok("the NCAR filter keeps it");
  await pub.getByLabel("Show a value on each pin").selectOption({ label: "Pins: Air temperature" });
  await pub.locator(".leaflet-marker-icon", { hasText: "22.5" }).first().waitFor({ timeout: 10000 });
  ok("pins can show a reading");
  await pub.locator(".leaflet-marker-icon", { hasText: "22.5" }).first().click();
  await pub.locator(".leaflet-popup-content").getByText(NAME).waitFor({ timeout: 10000 });
  await pub.locator(".leaflet-popup-content").getByText("Humidity").waitFor();
  ok("popup shows the station and its readings");
  await pub.screenshot({ path: "screenshots/network-map.png" });
  await pub.setViewportSize({ width: 390, height: 844 });
  await pub.waitForTimeout(500);
  const overflow = await pub.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow <= 1, `no horizontal overflow on a phone (${overflow}px)`);
  await pub.screenshot({ path: "screenshots/network-map-mobile.png" });
  // Instruments on public CHORDS portals appear too, with no sign-in (needs internet access).
  const chordsPage = await anon.newPage();
  watch(chordsPage);
  await chordsPage.goto(`${base}/map`, { waitUntil: "networkidle" });
  const portalBtn = chordsPage.getByRole("button", { name: /IoTWx \(NCAR\) \(\d+\)/ });
  if (await portalBtn.waitFor({ timeout: 45000 }).then(() => true, () => false)) {
    const n = Number(/\((\d+)\)\s*$/.exec(await portalBtn.innerText())?.[1]);
    expect(n > 0, `the NCAR CHORDS portal contributes ${n} instruments`);
    const stat = await chordsPage.locator("dt", { hasText: "On CHORDS portals" }).locator("xpath=following-sibling::dd").innerText();
    expect(Number(stat) >= n, `the counter shows CHORDS instruments (${stat})`);
    await chordsPage.locator(".leaflet-marker-icon").first().waitFor({ timeout: 15000 });
    await chordsPage.getByRole("list", { name: "Stations on the map" }).getByText(/CHORDS · /).first().waitFor();
    ok("CHORDS instruments are listed and drawn");
    await chordsPage.screenshot({ path: "screenshots/network-map-chords.png" });
    await chordsPage.getByRole("button", { name: /IoTWx \(NCAR\)/ }).click();
    await chordsPage.waitForTimeout(500);
    const after = Number(await chordsPage.locator("dt", { hasText: "On CHORDS portals" }).locator("xpath=following-sibling::dd").innerText());
    expect(after < Number(stat), "switching a portal off removes its instruments");
  } else {
    console.log("info no answer from the public CHORDS portals, skipped the CHORDS check");
  }
  await anon.close();

  // Leaving keeps the station public but drops the NCAR flag.
  page.addLocatorHandler(page.getByRole("dialog"), (d) => d.getByRole("button").last().click()); // the themed confirm
  await page.goto(stationUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Leave the network" }).click();
  await page.getByText("Left the NCAR network").waitFor({ timeout: 15000 });
  ok("can leave the network");

  // A Raspberry Pi gateway: no key on the wire, the station is found by the id its owner entered.
  const GW = `PI-${stamp}`;
  await page.getByLabel("Gateway station id").fill(GW);
  await page.getByRole("button", { name: "Save gateway id" }).click();
  await page.getByText("Gateway id saved").waitFor({ timeout: 15000 });
  const bridge = process.env.INGEST_BRIDGE_TOKEN;
  if (bridge) {
    const bulk = await fetch(`${base}/api/ingest/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": bridge },
      body: JSON.stringify({
        items: [
          { gateway: GW, body: { station_id: GW, sensor: "bme680", measurement: "gas_resistance", reading_value: "1234", timestamp: Math.floor(Date.now() / 1000) } },
          { gateway: "unregistered-id", body: { sensor: "bme680", measurement: "temperature", reading_value: "1" } },
        ],
      }),
    });
    const { results } = await bulk.json();
    expect(results[0] === 202 && results[1] === 404, `the bridge files a gateway message under its station (${results})`);
    await page.waitForTimeout(2500);
    await page.goto(stationUrl, { waitUntil: "networkidle" });
    await page.getByText("Gas resistance").first().waitFor({ timeout: 15000 });
    ok("the gateway reading shows on the station page");
  } else {
    console.log("info INGEST_BRIDGE_TOKEN not set, skipped the bridge check");
  }

  // Admin database console (the first account on a fresh server is the super-admin).
  await page.goto(`${base}/admin/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(owner);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Network operations" }).waitFor({ timeout: 15000 });
  await page.getByRole("tab", { name: "database" }).click();
  await page.getByText("Database size").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /^measurements/ }).click();
  await page.locator("table").getByText("bme680_temperature").first().waitFor({ timeout: 15000 });
  ok("database console lists tables and shows readings");
  await page.getByRole("button", { name: /^stations/ }).click();
  await page.locator("table").getByText(NAME.toLowerCase().replace(/\s+/g, "-")).first().waitFor({ timeout: 15000 });
  const head = await page.locator("thead").innerText();
  expect(!/hash/i.test(head), "secret columns are never listed");
  await page.screenshot({ path: "screenshots/admin-database.png" });

  if (errors.length) bad(`browser errors: ${errors.slice(0, 4).join(" | ")}`);
} catch (e) {
  bad(e.message);
} finally {
  await browser.close();
}
console.log(failed ? "MAP E2E FAILED" : "Map E2E passed");
process.exitCode = failed ? 1 : 0;
