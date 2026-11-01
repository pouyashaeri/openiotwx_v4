#!/usr/bin/env node
/**
 * Ingest load test. Creates throwaway stations straight in the database, then
 * posts readings at /api/ingest from many concurrent "stations" and reports
 * throughput, latency and how the server pushed back.
 *
 *   DATABASE_URL=postgres://… node scripts/loadtest.mjs \
 *     [--url http://localhost] [--stations 500] [--seconds 20] [--concurrency 200] [--readings 10]
 *
 * --readings is how many timestamped readings (3 metrics each) go in one request.
 * Test stations are deleted afterwards unless --keep is given.
 */
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const URL_ = arg("url", "http://localhost:8080").replace(/\/$/, "");
const STATIONS = Number(arg("stations", 500));
const SECONDS = Number(arg("seconds", 20));
const CONCURRENCY = Number(arg("concurrency", 200));
const READINGS = Number(arg("readings", 10));
const KEEP = process.argv.includes("--keep");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (the script creates test stations directly).");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

const keys = [];
for (let i = 0; i < STATIONS; i += 1) {
  const key = `iotwx_${randomBytes(24).toString("base64url")}`;
  const slug = `loadtest-${i}-${randomBytes(2).toString("hex")}`;
  await pool.query(
    `insert into stations (owner_id, slug, name, api_key_hash, api_key_hint, rate_limit_per_min)
     values ('loadtest', $1, $2, $3, $4, 100000)`,
    [slug, `Load test ${i}`, createHash("sha256").update(key).digest("hex"), key.slice(0, 10)],
  );
  keys.push(key);
}
console.log(`created ${STATIONS} stations; ${CONCURRENCY} workers for ${SECONDS}s against ${URL_}`);

const counts = {};
const lat = [];
let sent = 0;
const end = Date.now() + SECONDS * 1000;
let seq = 0;

async function worker(n) {
  while (Date.now() < end) {
    const key = keys[(n + seq++) % keys.length];
    const base = Date.now();
    const readings = Array.from({ length: READINGS }, (_, i) => ({
      ts: new Date(base - i * 1000 - Math.floor(Math.random() * 1000)).toISOString(),
      values: { temp_c: 15 + Math.random() * 10, humidity_pct: 30 + Math.random() * 50, pressure_hpa: 1000 + Math.random() * 20 },
    }));
    const t0 = performance.now();
    try {
      const res = await fetch(`${URL_}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({ readings }),
      });
      await res.arrayBuffer();
      lat.push(performance.now() - t0);
      counts[res.status] = (counts[res.status] ?? 0) + 1;
      if (res.status === 202) sent += READINGS * 3;
      if (res.status === 503 || res.status === 429) {
        await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") ?? 1) * 100));
      }
    } catch {
      counts.error = (counts.error ?? 0) + 1;
    }
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, (_, n) => worker(n)));
const secs = (Date.now() - started) / 1000;

lat.sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]?.toFixed(1);
console.log(`\nrequests/s : ${(lat.length / secs).toFixed(0)}`);
console.log(`values/s   : ${(sent / secs).toFixed(0)} accepted`);
console.log(`latency ms : p50 ${q(0.5)}  p95 ${q(0.95)}  p99 ${q(0.99)}`);
console.log(`status     : ${JSON.stringify(counts)}`);

// Let the server flush its buffer, then check what actually landed.
await new Promise((r) => setTimeout(r, 4000));
const { rows } = await pool.query(
  `select count(*)::int as n from measurements m join stations s on s.id = m.station_id where s.owner_id = 'loadtest'`,
);
console.log(`stored     : ${rows[0].n} rows (${sent} accepted; duplicates collapse by design)`);

if (!KEEP) {
  await pool.query(`delete from measurements where station_id in (select id from stations where owner_id = 'loadtest')`);
  await pool.query(`delete from stations where owner_id = 'loadtest'`);
  console.log("cleaned up test stations");
}
await pool.end();
