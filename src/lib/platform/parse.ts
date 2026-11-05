/** Pure request parsing for the ingest API — no I/O, so it is unit-tested directly. */
import { METRIC_NAME } from "./metrics.ts";

export const MAX_READINGS = 500;
export const MAX_POINTS = 2000;
const MAX_FUTURE_MS = 5 * 60_000;
const MAX_PAST_MS = 30 * 24 * 3600_000;

export type Row = { t: number; station: string; metric: string; value: number };

// Plain fields, not constructor parameter properties: Node's built-in TypeScript mode (what `npm test` uses) cannot run those.
export class IngestError extends Error {
  readonly status: number;
  readonly retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}


export function parseTime(raw: unknown, now: number): number | null {
  if (raw === undefined || raw === null) return now;
  let ms: number;
  if (typeof raw === "number") ms = raw < 1e11 ? raw * 1000 : raw; // seconds or ms
  else if (typeof raw === "string") ms = Date.parse(raw);
  else return null;
  if (!Number.isFinite(ms) || ms > now + MAX_FUTURE_MS || ms < now - MAX_PAST_MS) return null;
  return ms;
}

/**
 * Turn a CHORDS-style URL query (`instrument_id=3&at=…&t1=22.5&rh1=40&api_key=…`)
 * into an ingest body. Everything that isn't a reserved CHORDS field is a
 * measurement; shortnames are lower-cased. Returns the claimed instrument id,
 * the key, and whether it was flagged as a test upload.
 */
export function fromChordsQuery(params: URLSearchParams): {
  instrumentId: number | null;
  key: string | null;
  test: boolean;
  body: { ts?: string; values: Record<string, unknown> };
} {
  const RESERVED = new Set(["instrument_id", "at", "email", "api_key", "key", "test"]);
  const values: Record<string, unknown> = {};
  for (const [k, v] of params) {
    if (RESERVED.has(k.toLowerCase())) continue;
    const n = v.trim() === "" ? Number.NaN : Number(v);
    values[k.toLowerCase()] = n;
  }
  const id = Number(params.get("instrument_id"));
  const at = params.get("at");
  return {
    instrumentId: Number.isInteger(id) && id > 0 ? id : null,
    key: params.get("api_key") ?? params.get("key"),
    test: params.has("test"),
    // CHORDS timestamps without a zone are UTC.
    body: { ...(at ? { ts: /[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at}Z` } : {}), values },
  };
}

export function parseBody(
  body: unknown,
  station: string,
  allowed: Set<string> | null = null,
): { rows: Row[]; rejected: number } {
  const now = Date.now();
  const rows: Row[] = [];
  let rejected = 0;
  const list: unknown[] =
    body && typeof body === "object" && Array.isArray((body as { readings?: unknown }).readings)
      ? (body as { readings: unknown[] }).readings
      : [body];
  if (list.length > MAX_READINGS) {
    throw new IngestError(413, `At most ${MAX_READINGS} readings per request`);
  }
  for (const item of list) {
    const r = item as { ts?: unknown; time?: unknown; values?: unknown } | null;
    const values = r && typeof r === "object" ? r.values : null;
    const t = parseTime(r?.ts ?? r?.time, now);
    if (!values || typeof values !== "object" || Array.isArray(values) || t === null) {
      rejected += 1;
      continue;
    }
    for (const [metric, value] of Object.entries(values as Record<string, unknown>)) {
      if (rows.length >= MAX_POINTS) {
        throw new IngestError(413, `At most ${MAX_POINTS} values per request`);
      }
      if (
        !METRIC_NAME.test(metric) ||
        (allowed && !allowed.has(metric)) ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e9
      ) {
        rejected += 1;
        continue;
      }
      rows.push({ t, station, metric, value });
    }
  }
  return { rows, rejected };
}
