/**
 * Reading from other CHORDS portals (server-only): browse their instruments,
 * and keep imported instruments in sync as normal stations of ours.
 *
 * The portal URL comes from a user, so every request goes through `safeFetch`:
 * http(s) only, hostnames must resolve to public addresses (no loopback, private
 * ranges or cloud metadata), redirects are re-checked, and time and size are
 * capped. Set CHORDS_ALLOW_PRIVATE=1 to allow private addresses, for a portal
 * on your own network (or for testing against this server).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { getSql } from "@/lib/db";
import { fixUsPosition, parseChordsData, type Observation } from "./chords-format.ts";
import { writeRows } from "./ingest.server";
import { METRIC_NAME } from "./metrics";

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 25_000;

// ── SSRF guard ───────────────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That is not a valid web address");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https portals are supported");
  if (u.username || u.password) throw new Error("Do not put a login in the address");
  if (process.env.CHORDS_ALLOW_PRIVATE === "1") return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`Could not find ${u.hostname}`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("That address is not on the public internet");
  return u;
}

export async function safeFetch(raw: string): Promise<{ status: number; type: string; text: string }> {
  let url = raw;
  for (let hop = 0; hop < 4; hop += 1) {
    const u = await assertPublicUrl(url);
    const res = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json, text/csv, */*", "user-agent": "openiotwx-importer/1" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, u).toString();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("The portal's answer is too large; try a shorter time range");
      }
      chunks.push(value);
    }
    return { status: res.status, type: res.headers.get("content-type") ?? "", text: Buffer.concat(chunks).toString("utf8") };
  }
  throw new Error("Too many redirects");
}

export function normalizePortal(input: string): string {
  const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
}

// ── secrets at rest ──────────────────────────────────────────────────────────

const secretKey = () =>
  createHash("sha256")
    .update(process.env.BETTER_AUTH_SECRET || "openiotwx-dev-only-secret")
    .digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function unseal(sealed: string): string {
  const [iv, tag, enc] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", secretKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ── browsing a portal ────────────────────────────────────────────────────────

export type RemoteInstrument = { id: number; name: string; sensor_id: string | null; site_id: number | null };
export type RemoteSite = { id: number; name: string; lat: number | null; lon: number | null };
export type RemoteVar = { name: string; shortname: string; instrument_id: number };

async function getJson<T>(portal: string, path: string): Promise<T> {
  const res = await safeFetch(`${portal}${path}`);
  if (res.status !== 200) throw new Error(`${portal}${path} answered ${res.status}. Is this a CHORDS portal?`);
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new Error(`${portal}${path} did not return JSON. Is this a CHORDS portal?`);
  }
}

export async function browsePortal(portalInput: string, limit = 500) {
  const portal = normalizePortal(portalInput);
  const [instruments, sites, vars] = await Promise.all([
    getJson<RemoteInstrument[]>(portal, "/instruments.json"),
    getJson<{ id: number; name: string; lat: string | null; lon: string | null }[]>(portal, "/sites.json").catch(() => []),
    getJson<RemoteVar[]>(portal, "/vars.json").catch(() => []),
  ]);
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const varsByInstrument = new Map<number, { shortname: string; name: string }[]>();
  for (const v of vars) {
    const list = varsByInstrument.get(v.instrument_id) ?? [];
    list.push({ shortname: v.shortname, name: v.name });
    varsByInstrument.set(v.instrument_id, list);
  }
  return {
    portal,
    instruments: instruments.slice(0, limit).map((i) => {
      const site = i.site_id != null ? siteById.get(i.site_id) : undefined;
      const lat = site?.lat != null ? Number(site.lat) : null;
      const lon = site?.lon != null ? Number(site.lon) : null;
      return {
        id: i.id,
        name: i.name,
        site: site?.name ?? null,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        vars: varsByInstrument.get(i.id) ?? [],
      };
    }),
  };
}

// ── pulling data ─────────────────────────────────────────────────────────────

export type Remote = {
  portal: string;
  instrumentId: number;
  email?: string;
  lastSync?: string | null;
  nextSync?: string | null;
  everyMin?: number;
  lastError?: string | null;
};

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);

/** Fetch observations for [from, to]. Newer portals serve /api/v1/data, older ones /instruments. */
export async function fetchObservations(
  remote: Remote,
  keyEnc: string | null,
  from: number,
  to: number,
): Promise<Observation[]> {
  const auth = keyEnc && remote.email ? `&email=${encodeURIComponent(remote.email)}&api_key=${encodeURIComponent(unseal(keyEnc))}` : "";
  const range = `start=${iso(from)}&end=${iso(to)}${auth}`;
  const tries = [
    `/api/v1/data/${remote.instrumentId}.csv?${range}`,
    `/api/v1/data/${remote.instrumentId}.json?${range}`,
    `/instruments/${remote.instrumentId}.csv?${range}`,
    `/instruments/${remote.instrumentId}.json?${range}`,
  ];
  let lastStatus = 0;
  for (const path of tries) {
    const res = await safeFetch(`${remote.portal}${path}`);
    lastStatus = res.status;
    if (res.status === 200) {
      const obs = parseChordsData(res.text, res.type);
      if (obs.length) return obs;
    }
  }
  if (lastStatus === 401 || lastStatus === 403 || lastStatus === 406) {
    throw new Error("This portal lists its instruments publicly but does not allow data downloads without an account. Ask its owner for an email and API key (or to turn off the download key requirement), then re-import with them.");
  }
  return []; // reachable but nothing in range
}

/** Pull new data for one imported station into our database. Returns rows seen. */
export async function syncStation(id: string, backfillDays = 30): Promise<{ rows: number }> {
  const sql = await getSql();
  const found = await sql<{ id: string; remote: Remote | null; remote_key: string | null }>`
    select id, remote, remote_key from stations where id = ${id} and source = 'chords'`;
  const st = found[0];
  if (!st?.remote) throw new Error("This station is not linked to a CHORDS portal");
  const remote = st.remote;
  const now = Date.now();
  const from = remote.lastSync ? Date.parse(remote.lastSync) - 60_000 : now - backfillDays * 86_400_000;
  const every = remote.everyMin ?? 15;
  try {
    const obs = await fetchObservations(remote, st.remote_key, from, now);
    const rows = obs.flatMap((o) =>
      Object.entries(o.values)
        .filter(([metric]) => METRIC_NAME.test(metric))
        .map(([metric, value]) => ({ t: o.t, station: id, metric, value })),
    );
    for (let i = 0; i < rows.length; i += 5000) await writeRows(rows.slice(i, i + 5000));
    const seen = [...new Set(rows.map((r) => r.metric))];
    const newest = obs.length ? Math.max(...obs.map((o) => o.t)) : null;
    const next: Remote = {
      ...remote,
      lastSync: new Date(newest ?? now).toISOString(),
      nextSync: new Date(now + every * 60_000).toISOString(),
      lastError: null,
    };
    await sql`update stations set remote = ${JSON.stringify(next)}::jsonb,
      expected_metrics = (select coalesce(array_agg(distinct m), '{}') from unnest(expected_metrics || ${seen}::text[]) as m)
      where id = ${id}`;
    return { rows: rows.length };
  } catch (e) {
    const next: Remote = {
      ...remote,
      nextSync: new Date(now + Math.max(every, 15) * 60_000).toISOString(),
      lastError: e instanceof Error ? e.message : String(e),
    };
    await sql`update stations set remote = ${JSON.stringify(next)}::jsonb where id = ${id}`;
    throw e;
  }
}

// ── scheduler ────────────────────────────────────────────────────────────────

const g = globalThis as typeof globalThis & { __chordsSync__?: ReturnType<typeof setInterval> };

/**
 * Every minute, sync the imported stations that are due. A station is claimed by
 * atomically pushing its `nextSync` forward, so several app replicas never pull
 * the same station twice. Disable with CHORDS_SYNC=off.
 */
export function startChordsSync(): void {
  if (g.__chordsSync__ || process.env.CHORDS_SYNC === "off") return;
  g.__chordsSync__ = setInterval(async () => {
    try {
      const sql = await getSql();
      const due = await sql<{ id: string }>`
        update stations set remote = jsonb_set(remote, '{nextSync}', to_jsonb((now() + interval '10 minutes')::text))
        where id in (
          select id from stations
          where source = 'chords' and status = 'active'
            and (remote->>'nextSync' is null or (remote->>'nextSync')::timestamptz <= now())
          limit 5)
        returning id`;
      for (const { id } of due) await syncStation(id).catch((e) => console.error("[chords-sync]", id, e.message));
    } catch (e) {
      console.error("[chords-sync]", e instanceof Error ? e.message : e);
    }
  }, 60_000);
  g.__chordsSync__.unref?.();
}

// ── the network map ──────────────────────────────────────────────────────────

export type PortalPin = { id: number; name: string; site: string | null; lat: number; lon: number; vars: string[] };

const mapCache = new Map<string, { at: number; pins: PortalPin[] }>();
const MAP_TTL_MS = 10 * 60_000;

/**
 * Every instrument on a portal that has a position, for the map. Cached for ten minutes so a busy
 * map never hammers someone else's server, and an unreachable portal falls back to its last good copy.
 */
export async function mapPortal(portalInput: string): Promise<{ portal: string; pins: PortalPin[]; stale: boolean }> {
  const portal = normalizePortal(portalInput);
  const hit = mapCache.get(portal);
  if (hit && Date.now() - hit.at < MAP_TTL_MS) return { portal, pins: hit.pins, stale: false };
  try {
    const { instruments } = await browsePortal(portal, 5000);
    const pins = instruments
      .filter((i): i is typeof i & { lat: number; lon: number } => i.lat !== null && i.lon !== null && Math.abs(i.lat) <= 90 && Math.abs(i.lon) <= 180)
      .flatMap((i) => {
        const at = fixUsPosition(i.site, i.lat, i.lon);
        return at ? [{ id: i.id, name: i.name, site: i.site, lat: at.lat, lon: at.lon, vars: i.vars.map((v) => v.shortname).slice(0, 12) }] : [];
      });
    if (mapCache.size > 50) mapCache.clear();
    mapCache.set(portal, { at: Date.now(), pins });
    return { portal, pins, stale: false };
  } catch (e) {
    if (hit) return { portal, pins: hit.pins, stale: true };
    throw e;
  }
}
