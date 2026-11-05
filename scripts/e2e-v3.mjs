#!/usr/bin/env node
/**
 * v3's pages and the community hub that serves them, inside our app: wizard additions, home
 * pathway, place profile, Analysis, Forecast, Community, GDEX consent, who may write what,
 * and the Sign in hover. Start the server with HUB_TOKEN=hubtest.
 *
 *   HUB_TOKEN=hubtest npm run dev      (or any base URL: node scripts/e2e-v3.mjs http://localhost:8090)
 *   node scripts/e2e-v3.mjs [baseUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8080";
const TOKEN = process.env.HUB_TOKEN ?? "hubtest";
let failed = false;
const ok = (m) => console.log("ok  ", m);
const info = (m) => console.log("info", m);
const bad = (m) => {
  failed = true;
  console.error("FAIL:", m);
};
const expect = (c, m) => (c ? ok(m) : bad(m));

const draft = (over = {}) =>
  JSON.stringify({
    answers: {
      intent: "community", place: "edge", power: "outlet", link: "wifi", measures: ["air", "rain", "pm"], sharp: false, count: 3,
      surprises: ["heat", "air", "fire"], who: ["neighbors"], progress: ["trust"], gaps: ["nomeasure"],
      resources: ["printer", "hands"], sharing: "community", gdex: false,
      location: { lat: 40.015, lon: -105.27, label: "Boulder, Colorado" },
      ...over,
    },
    step: "review", checks: {}, goals: [], goalLog: [], goalsTouched: false, siteName: "Maple Street", startedAt: new Date().toISOString(),
  });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));

/** A request made by the page itself, so it carries the signed-in session. */
const hub = (method, path, body, headers = {}) =>
  page.evaluate(
    async ([m, p, b, h]) => {
      const r = await fetch(`/hub${p}`, { method: m, headers: { "content-type": "application/json", ...h }, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [method, path, body ?? null, headers],
  );
const anon = async (method, path, body, headers = {}) => {
  const r = await fetch(`${base}/hub${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const useDraft = async (over, step) => {
  // A static file, so the app is not running to write its own old draft back over ours.
  await page.goto(`${base}/favicon.svg`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([d, st]) => {
    const parsed = JSON.parse(d);
    if (st) parsed.step = st;
    localStorage.setItem("openiotwx-draft-v3", JSON.stringify(parsed));
  }, [draft(over), step ?? null]);
};

try {
  // ── Signed out: the public face ───────────────────────────────────────────
  await useDraft();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "From a local concern to a decision you can defend" }).waitFor();
  const stops = await page.locator("#pathway-title").locator("xpath=following::ol[1]//li").count();
  expect(stops === 5, `the home page shows v3's five-stop pathway (${stops} stops)`);

  // Wizard steps v3 added.
  await useDraft({}, "surprises");
  await page.goto(`${base}/wizard`);
  await page.getByText(/wildfire/i).first().waitFor({ timeout: 40000 });
  ok("the wizard offers the wildfire concern");
  await useDraft({}, "resources");
  await page.goto(`${base}/wizard`);
  await page.getByRole("heading", { name: "What can the people around this station bring?" }).waitFor({ timeout: 40000 });
  ok("the Resources step is in the wizard");
  await useDraft({}, "data");
  await page.goto(`${base}/wizard`);
  await page.getByRole("heading", { name: "Where should the readings live?" }).waitFor({ timeout: 40000 });
  ok("the Data sharing step is in the wizard");
  await useDraft({}, "review");
  await page.goto(`${base}/wizard`);
  await page.getByPlaceholder("Boulder, CO or 80302 or 40.015, -105.27").waitFor({ timeout: 40000 });
  ok("the review step has the site location picker");

  // The pages that talk to the hub, with no stations yet.
  await useDraft();
  await page.goto(`${base}/analysis`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /in context/ }).waitFor();
  await page.getByText(/Server \/hub/).waitFor({ timeout: 40000 });
  ok("the pages default to this site's own server (/hub)");
  await page.getByText(/Showing a sample week|on your community server/).first().waitFor({ timeout: 30000 });
  ok("Analysis says where its data comes from (a sample week, or a station on the server)");
  await page.getByText("Wildfire season").first().waitFor();
  ok("decision cards include the wildfire concern");

  // Live public data: the CDC vulnerability index and EJScreen. Offline machines skip this check.
  const profile = page.locator("section").filter({ hasText: "Place profile" }).first();
  const reachable = await fetch("https://services3.arcgis.com/ZvidGQkLaDJxRSJ2/ArcGIS/rest/services/CDC_ATSDR_Social_Vulnerability_Index_2022_USA/FeatureServer?f=json", { signal: AbortSignal.timeout(8000) })
    .then((r) => r.ok)
    .catch(() => false);
  if (reachable) {
    await profile.getByText(/Census Tract/).waitFor({ timeout: 60000 });
    const text = await profile.innerText();
    expect(/\d+(st|nd|rd|th)/.test(text) && /Boulder County/.test(text), "the live place profile loads the Boulder tract (CDC Social Vulnerability Index)");
  } else {
    info("live place profile skipped: the public services are not reachable from this machine");
  }

  // Who may write what, signed out.
  expect((await anon("POST", "/api/forecast-runs/", { latitude: 40, longitude: -105 })).status === 401, "a forecast request needs sign-in");
  expect((await anon("POST", "/api/collective/members/", { name: "x" })).status === 401, "posting an offer needs sign-in");
  expect((await anon("POST", "/api/credit-forecast/", [])).status === 401, "forecast values need the service token");
  expect((await anon("POST", "/api/credit-forecast/", [], { "x-hub-token": "wrong" })).status === 401, "a wrong token is refused");
  expect((await anon("PUT", "/api/forecast-runs/1?status=done")).status === 401, "run updates need the service token");

  // The Sign in hover.
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const signIn = page.locator("header").getByRole("link", { name: "Sign in" });
  const glow = () => signIn.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, bg: getComputedStyle(el).backgroundColor }));
  const before = await glow();
  await signIn.hover();
  await page.waitForTimeout(450);
  const after = await glow();
  expect(before.shadow === "none" && after.shadow !== "none" && before.bg !== after.bg, "the header Sign in button brightens and glows softly on hover");
  await page.mouse.move(5, 5);
  const plan = page.getByRole("link", { name: "Plan a station" });
  const shadowOf = () => plan.evaluate((el) => getComputedStyle(el).boxShadow);
  const p0 = await shadowOf();
  await plan.hover();
  await page.waitForTimeout(450);
  expect(p0 === "none" && (await shadowOf()) !== "none", "the Plan a station button glows softly on hover too");
  await page.mouse.move(5, 5);

  await useDraft();
  await page.goto(`${base}/plan`, { waitUntil: "domcontentloaded" });
  const planSignIn = page.getByRole("link", { name: "Sign in or create an account" });
  await planSignIn.waitFor({ timeout: 40000 });
  const ps = () => planSignIn.evaluate((el) => getComputedStyle(el).boxShadow);
  const ps0 = await ps();
  await planSignIn.hover();
  await page.waitForTimeout(450);
  expect(ps0 === "none" && (await ps()) !== "none", "the plan page's Sign in or create an account button glows on hover too");
  await page.mouse.move(5, 5);

  // ── Signed in: our accounts in front of the hub ───────────────────────────
  await page.goto(`${base}/login?next=/account`, { waitUntil: "networkidle" });
  const loginBtn = page.locator("form button[type=submit]");
  const l0 = await loginBtn.evaluate((el) => getComputedStyle(el).boxShadow);
  await loginBtn.hover();
  await page.waitForTimeout(450);
  const l1 = await loginBtn.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(l0 === "none" && l1 !== "none", "the Sign in button on the login page glows on hover too");
  await page.mouse.move(5, 5);

  // A too-short password gets the site's own message, not the browser's pop-up.
  expect(await page.locator("form").evaluate((f) => f.noValidate), "the login form leaves checking to the site (no browser pop-ups)");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill("abc");
  await loginBtn.click();
  await page.getByRole("alert").filter({ hasText: "Wrong email or password." }).waitFor({ timeout: 15000 });
  ok("a short password on Sign in just says: Wrong email or password.");
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill("abc");
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.getByRole("alert").filter({ hasText: "too short" }).waitFor({ timeout: 15000 });
  ok("a short password on Create account says so in the site's own style");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Name").fill("Hub Tester");
  await page.getByLabel("Email").fill(`hub-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL((u) => u.pathname === "/account");
  await page.getByRole("heading", { name: "Hub Tester" }).waitFor();

  // A real station with a location and three days of readings.
  await page.getByText("Add a station by hand").click();
  await page.getByLabel("New station name").fill("Hub Test");
  await page.getByLabel("Air temperature (°C)").check();
  await page.getByRole("button", { name: "Add station" }).click();
  const key = (await page.locator("pre").first().innerText()).trim();
  await page.getByRole("link", { name: "Hub Test" }).first().click();
  await page.waitForURL((u) => u.pathname.startsWith("/stations/"));
  const slug = new URL(page.url()).pathname.split("/").pop();
  await page.getByLabel("Latitude (−90 to 90)").first().fill("40.02");
  await page.getByLabel("Longitude (−180 to 180)").first().fill("-105.27");
  await page.getByRole("button", { name: "Save location" }).click();
  await page.getByText("Location saved").waitFor();
  const now = Date.now();
  const readings = Array.from({ length: 72 }, (_, i) => ({
    ts: new Date(now - (71 - i) * 3600_000).toISOString(),
    values: { temp_c: 18 + 6 * Math.sin((2 * Math.PI * (i % 24)) / 24), humidity_pct: 40 + (i % 24), pressure_hpa: 1012 + (i % 5) / 5, wind_ms: 3 + (i % 7) / 3 },
  }));
  const up = await fetch(`${base}/api/ingest`, { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ readings }) });
  expect(up.status === 202, "readings arrive for a real station");
  await page.waitForTimeout(2500);

  // The hub speaks v3's shapes, in v3's names, from our data.
  const stations = await hub("GET", "/api/stations/");
  const mine = stations.body?.find((s) => s.station_id === slug);
  expect(Boolean(mine) && mine.latitude === 40.02, "the hub lists our station in v3's format");
  const rd = await hub("GET", `/api/readings/${slug}?hours=72`);
  const names = new Set((rd.body ?? []).map((r) => r.measurement));
  expect(["temperature", "humidity", "pressure", "wind_speed"].every((n) => names.has(n)), `readings use v3's names (${[...names].join(", ")})`);
  expect((rd.body ?? []).length >= 60 && (rd.body ?? []).length <= 4 * 74, `readings come hourly (${(rd.body ?? []).length} rows for 72 h, 4 variables)`);
  expect((await anon("GET", `/api/readings/${slug}`)).status === 404, "a private station's readings are hidden from the public");

  // Analysis now shows OUR station, not the sample.
  await useDraft({ location: { lat: 40.02, lon: -105.27, label: "Boulder, Colorado" } });
  await page.goto(`${base}/analysis`, { waitUntil: "domcontentloaded" });
  await page.getByText(new RegExp(`Readings from ${slug} on your community server`)).waitFor({ timeout: 30000 });
  ok("Analysis draws our own station's readings (no longer the sample week)");

  // Forecast: request a run, then play the part of the runner.
  await page.goto(`${base}/forecast`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Request a \d-day forecast/ }).click();
  await page.getByText(/Forecast queued/).waitFor({ timeout: 20000 });
  ok("a signed-in person can request a CREDIT run");
  const runs = await hub("GET", "/api/forecast-runs/");
  const run = runs.body?.[0];
  expect(runs.body?.length === 1 && run.status === "queued" && run.backend === "local", "the run is queued on the local backend");
  expect((await anon("GET", "/api/forecast-runs/")).body?.length === 0, "other people don't see it");
  const queuedForRunner = await anon("GET", "/api/forecast-runs/?status=queued", undefined, { "x-hub-token": TOKEN });
  expect(queuedForRunner.body?.length === 1, "the runner (with the token) sees the queued run");
  const init = new Date(Math.floor(now / 3600_000) * 3600_000).toISOString();
  const values = Array.from({ length: 48 }, (_, h) => ({
    run_id: run.id, station_id: slug, variable: "t2m", init_time: init, valid_time: new Date(Date.parse(init) + h * 3600_000).toISOString(), value: 290 + 4 * Math.sin(h / 4), source: "credit",
  }));
  const put = await anon("POST", "/api/credit-forecast/", values, { "x-hub-token": TOKEN });
  expect(put.status === 200 && put.body.inserted === 48, "the runner posts forecast values");
  const done = await anon("PUT", `/api/forecast-runs/${run.id}?status=done&cid=bafytestcid&detail=ok`, undefined, { "x-hub-token": TOKEN });
  expect(done.body?.status === "done" && done.body.cid === "bafytestcid", "and marks the run done with its IPFS id");
  const fc = await hub("GET", `/api/credit-forecast/${slug}/`);
  expect(fc.body?.length === 48 && fc.body[0].variable === "t2m", "the forecast is served back for the station");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("bafytestcid").first().waitFor({ timeout: 20000 });
  ok("the Forecast page shows the finished run and its IPFS id");

  // Community: offers, print queue, and contact privacy.
  await useDraft({ resources: ["printer"] });
  await page.goto(`${base}/community`, { waitUntil: "domcontentloaded" });
  const join = page.locator('section[aria-labelledby="join-title"]');
  await join.getByLabel("Name").fill("Maker Mia");
  await join.getByLabel("How to reach you").fill("mia@example.com");
  await join.getByLabel("Where").fill("Boulder");
  await join.getByRole("button", { pressed: false }).first().click();
  await join.getByRole("button", { name: "Post my offer" }).click();
  await page.getByText("You are on the board").waitFor({ timeout: 40000 });
  const members = await anon("GET", "/api/collective/members/");
  const mia = members.body?.find((m) => m.name === "Maker Mia");
  expect(Boolean(mia) && mia.contact === "", "the offer is on the public board, and the contact details are not");
  const saveQueue = page.getByRole("button", { name: /Save/ }).first();
  await saveQueue.click();
  await page.getByText("Print queue saved on the community server").waitFor({ timeout: 40000 });
  const inv = await anon("GET", "/api/collective/inventory/");
  expect((inv.body ?? []).length > 0, `the print queue is shared (${(inv.body ?? []).length} parts)`);

  // GDEX: a recorded decision needs a person, and is kept per account.
  await useDraft({});
  await page.goto(`${base}/plan`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Data steward (a person)").fill("Dr. Rivera");
  await page.getByRole("button", { name: "Record this decision" }).click();
  await page.getByText("Consent recorded on the community server").waitFor({ timeout: 40000 });
  const consent = await hub("GET", "/api/consent/");
  expect(consent.body?.some((c) => c.steward === "Dr. Rivera" && c.gdex === false && c.station_id === "maple_street"), "the consent decision is recorded (GDEX still off)");
  expect((await anon("GET", "/api/consent/")).body?.length === 0, "and other people cannot read it");

  if (errors.length) bad(`browser errors: ${errors.slice(0, 3).join(" | ")}`);
} catch (e) {
  bad(e.message);
  await page.screenshot({ path: "screenshots/e2e-failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failed ? "V3 E2E FAILED" : "V3 E2E passed");
process.exitCode = failed ? 1 : 0;
