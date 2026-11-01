/**
 * Station ingest pipeline (server-only).
 *
 *   request → authenticate key (cached) → rate-limit → validate → in-memory buffer
 *           → batched, idempotent INSERT (one statement per flush) → 202
 *
 * The request path never touches the database on a warm key: it answers from the
 * buffer, and a single timer flushes thousands of rows per statement. When the
 * buffer is full the endpoint answers 503 + Retry-After (backpressure) instead
 * of queueing unbounded memory; stations retry, and the unique index makes that
 * retry idempotent. Run as many app replicas as needed — each has its own buffer.
 */
import { getSql } from "@/lib/db";
import { IngestError, parseBody, type Row } from "./parse.ts";
import { hashKey } from "./keys.server";

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const BATCH_ROWS = num("INGEST_BATCH_ROWS", 2000);
const FLUSH_MS = num("INGEST_FLUSH_MS", 1000);
const MAX_BUFFER = num("INGEST_MAX_BUFFER", 100_000);
const KEY_TTL_MS = 30_000;
const BAD_KEY_TTL_MS = 5_000;

type Auth = {
  id: string;
  slug: string;
  limit: number;
  chordsId: number;
  allowed: Set<string> | null;
} | null;
type Bucket = { tokens: number; at: number };

type State = {
  buffer: Row[];
  flushing: boolean;
  timer: ReturnType<typeof setInterval> | null;
  keys: Map<string, { auth: Auth; until: number }>;
  buckets: Map<string, Bucket>;
  stats: {
    accepted: number;
    rejected: number;
    flushed: number;
    flushes: number;
    errors: number;
    limited: number;
    shed: number;
    lastError: string;
    startedAt: number;
  };
};

const g = globalThis as typeof globalThis & { __ingest__?: State };
const S: State = (g.__ingest__ ??= {
  buffer: [],
  flushing: false,
  timer: null,
  keys: new Map(),
  buckets: new Map(),
  stats: {
    accepted: 0,
    rejected: 0,
    flushed: 0,
    flushes: 0,
    errors: 0,
    limited: 0,
    shed: 0,
    lastError: "",
    startedAt: Date.now(),
  },
});

async function authenticate(key: string): Promise<Auth> {
  const hash = hashKey(key);
  const hit = S.keys.get(hash);
  if (hit && hit.until > Date.now()) return hit.auth;
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    slug: string;
    status: string;
    rate_limit_per_min: number;
    chords_id: number;
    strict_metrics: boolean;
    expected_metrics: string[];
  }>`select id, slug, status, rate_limit_per_min, chords_id, strict_metrics, expected_metrics
    from stations where api_key_hash = ${hash} and source = 'device'`;
  const row = rows[0];
  const auth: Auth =
    row && row.status === "active"
      ? {
          id: row.id,
          slug: row.slug,
          limit: row.rate_limit_per_min,
          chordsId: row.chords_id,
          // "Accept only the variables I enabled" — an empty list never locks a station out.
          allowed: row.strict_metrics && row.expected_metrics.length ? new Set(row.expected_metrics) : null,
        }
      : null;
  if (S.keys.size > 10_000) S.keys.clear(); // bound memory under key-guessing floods
  S.keys.set(hash, { auth, until: Date.now() + (auth ? KEY_TTL_MS : BAD_KEY_TTL_MS) });
  return auth;
}

/**
 * A station by the id its Raspberry Pi gateway reports. Used only by the MQTT bridge, which is
 * itself authenticated; the gateway's messages carry no key. Not cached: ids change rarely but must
 * stop working the moment an owner clears one.
 */
async function authenticateGateway(gatewayId: string): Promise<Auth> {
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    slug: string;
    status: string;
    rate_limit_per_min: number;
    chords_id: number;
    strict_metrics: boolean;
    expected_metrics: string[];
  }>`select id, slug, status, rate_limit_per_min, chords_id, strict_metrics, expected_metrics
    from stations where gateway_id = ${gatewayId} and source = 'device'`;
  const row = rows[0];
  return row && row.status === "active"
    ? {
        id: row.id,
        slug: row.slug,
        limit: row.rate_limit_per_min,
        chordsId: row.chords_id,
        allowed: row.strict_metrics && row.expected_metrics.length ? new Set(row.expected_metrics) : null,
      }
    : null;
}

/** The station a gateway id belongs to, or null when none is registered or it is disabled. */
export async function stationIdForGateway(gatewayId: string): Promise<string | null> {
  return (await authenticateGateway(gatewayId))?.id ?? null;
}

/** Drop cached key lookups, e.g. after an admin disables a station or rotates its key. */
export function forgetKeys(): void {
  S.keys.clear();
}

function takeToken(id: string, perMin: number): boolean {
  const now = Date.now();
  const b = S.buckets.get(id) ?? { tokens: perMin, at: now };
  b.tokens = Math.min(perMin, b.tokens + ((now - b.at) / 60_000) * perMin);
  b.at = now;
  const ok = b.tokens >= 1;
  if (ok) b.tokens -= 1;
  if (S.buckets.size > 50_000) S.buckets.clear();
  S.buckets.set(id, b);
  return ok;
}

/** Authenticate, rate-limit, validate and buffer one upload. */
export async function ingest(
  key: string | null,
  body: unknown,
  opts: { instrumentId?: number | null; gatewayId?: string } = {},
): Promise<{ accepted: number; rejected: number }> {
  if (!key && !opts.gatewayId) throw new IngestError(401, "Missing API key (x-api-key header)");
  const auth = opts.gatewayId ? await authenticateGateway(opts.gatewayId) : await authenticate(key as string);
  if (!auth) throw new IngestError(401, "Unknown or disabled station key");
  // CHORDS devices also name the instrument; it must be the one this key belongs to.
  if (opts.instrumentId != null && opts.instrumentId !== auth.chordsId) {
    throw new IngestError(401, "instrument_id does not match this key");
  }
  if (!takeToken(auth.id, auth.limit)) {
    S.stats.limited += 1;
    throw new IngestError(429, "Rate limit exceeded for this station", 10);
  }
  const { rows, rejected } = parseBody(body, auth.id, auth.allowed);
  if (rows.length === 0) {
    throw new IngestError(
      400,
      auth.allowed
        ? `No valid readings. This station only accepts: ${[...auth.allowed].join(", ")}`
        : 'No valid readings. Expected {"values":{"temp_c":21.4}} or {"readings":[...]}',
    );
  }
  if (S.buffer.length + rows.length > MAX_BUFFER) {
    S.stats.shed += 1;
    throw new IngestError(503, "Ingest is saturated, retry shortly", 5);
  }
  for (const row of rows) S.buffer.push(row);
  S.stats.accepted += rows.length;
  S.stats.rejected += rejected;
  start();
  if (S.buffer.length >= BATCH_ROWS) void flush();
  return { accepted: rows.length, rejected };
}

/** Idempotent bulk insert + latest-value bookkeeping. Used by the flusher and by CHORDS imports. */
export async function writeRows(batch: Row[]): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into measurements (time, station_id, metric, value)
     select * from unnest($1::timestamptz[], $2::uuid[], $3::text[], $4::float8[])
     on conflict (station_id, metric, time) do nothing`,
    [
      batch.map((r) => new Date(r.t)),
      batch.map((r) => r.station),
      batch.map((r) => r.metric),
      batch.map((r) => r.value),
    ],
  );
  // Latest value per (station, metric) in this batch → stations.last_values.
  const latest = new Map<string, Map<string, { v: number; t: number }>>();
  for (const r of batch) {
    const m = latest.get(r.station) ?? new Map<string, { v: number; t: number }>();
    const cur = m.get(r.metric);
    if (!cur || r.t >= cur.t) m.set(r.metric, { v: r.value, t: r.t });
    latest.set(r.station, m);
  }
  const ids = [...latest.keys()];
  const docs = ids.map((id) =>
    JSON.stringify(
      Object.fromEntries(
        [...latest.get(id)!].map(([k, x]) => [k, { v: x.v, t: new Date(x.t).toISOString() }]),
      ),
    ),
  );
  await sql.query(
    `update stations s set last_seen_at = now(), last_values = s.last_values || v.doc::jsonb
     from unnest($1::uuid[], $2::text[]) as v(id, doc) where s.id = v.id`,
    [ids, docs],
  );
}

export async function flush(): Promise<void> {
  if (S.flushing || S.buffer.length === 0) return;
  S.flushing = true;
  const batch = S.buffer.splice(0, Math.max(BATCH_ROWS, 5000));
  try {
    await writeRows(batch);
    S.stats.flushed += batch.length;
    S.stats.flushes += 1;
  } catch (err) {
    S.stats.errors += 1;
    S.stats.lastError = err instanceof Error ? err.message : String(err);
    console.error("[ingest] flush failed, will retry:", S.stats.lastError);
    if (S.buffer.length + batch.length <= MAX_BUFFER) S.buffer.unshift(...batch);
  } finally {
    S.flushing = false;
  }
  if (S.buffer.length >= BATCH_ROWS) void flush();
}

function start(): void {
  if (S.timer) return;
  S.timer = setInterval(() => void flush(), FLUSH_MS);
  S.timer.unref?.();
  const stop = async () => {
    for (let i = 0; i < 5 && S.buffer.length; i += 1) {
      S.flushing = false;
      await flush();
    }
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

export function ingestStats() {
  return {
    ...S.stats,
    buffered: S.buffer.length,
    maxBuffer: MAX_BUFFER,
    uptimeS: Math.round((Date.now() - S.stats.startedAt) / 1000),
  };
}

export { IngestError };

/** Validate a key (and, for CHORDS, its instrument id) without storing anything. */
export async function checkKey(key: string | null, instrumentId: number | null): Promise<void> {
  if (!key) throw new IngestError(401, "Missing API key");
  const auth = await authenticate(key);
  if (!auth) throw new IngestError(401, "Unknown or disabled station key");
  if (instrumentId != null && instrumentId !== auth.chordsId) {
    throw new IngestError(401, "instrument_id does not match this key");
  }
}

/** The station a key belongs to, or null when the key is unknown or disabled. */
export async function stationIdForKey(key: string | null): Promise<string | null> {
  if (!key) return null;
  return (await authenticate(key))?.id ?? null;
}
