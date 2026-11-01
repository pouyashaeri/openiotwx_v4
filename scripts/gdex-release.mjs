#!/usr/bin/env node
/**
 * The GDEX release scheduler. Every few hours it asks the app to build the DRAFT release for the period
 * that just ended (a month or a quarter, per the cadence set in the admin console). The app does nothing
 * if that draft already exists, so calling it often is harmless. It never marks a release ready: a person
 * reads the quality report and does that, and only then can GDEX pull it.
 *
 *   APP_URL=http://localhost:8080 GDEX_RELEASE_TOKEN=... node scripts/gdex-release.mjs          # keeps running
 *   APP_URL=http://localhost:8080 GDEX_RELEASE_TOKEN=... node scripts/gdex-release.mjs --once   # one check, then exit
 *   ... --period 2026-10                                                                        # build a specific finished period
 *
 * Environment: APP_URL, GDEX_RELEASE_TOKEN (the same value the app has), GDEX_CHECK_HOURS (default 12).
 * Exit status with --once: 0 when the call worked (even if nothing was due), 1 when it failed.
 */
const APP_URL = (process.env.APP_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TOKEN = process.env.GDEX_RELEASE_TOKEN ?? "";
const HOURS = Math.max(0.1, Number(process.env.GDEX_CHECK_HOURS ?? 12));
const once = process.argv.includes("--once");
const periodArg = process.argv.includes("--period") ? process.argv[process.argv.indexOf("--period") + 1] : undefined;

if (!TOKEN) {
  console.error("GDEX_RELEASE_TOKEN is not set. Use the same value as the app's GDEX_RELEASE_TOKEN.");
  process.exit(1);
}

const log = (m) => console.log(`[gdex-release ${new Date().toISOString()}] ${m}`);

async function check() {
  try {
    const res = await fetch(`${APP_URL}/api/gdex/release`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-gdex-token": TOKEN },
      body: JSON.stringify(periodArg ? { period: periodArg } : {}),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      log(`the app answered ${res.status}: ${body.error ?? "no detail"}`);
      return false;
    }
    log(`${body.period}: ${body.action}${body.detail ? `. ${body.detail}` : ""}${body.stations !== undefined ? ` (${body.stations} stations, ${body.observations} observations)` : ""}`);
    return true;
  } catch (e) {
    log(`could not reach ${APP_URL}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

if (once) process.exit((await check()) ? 0 : 1);

log(`checking ${APP_URL} every ${HOURS} h`);
for (;;) {
  await check();
  await new Promise((r) => setTimeout(r, HOURS * 3600_000));
}
