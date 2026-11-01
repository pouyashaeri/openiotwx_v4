/**
 * CHORDS data formats, both directions. Pure functions, no I/O.
 *
 * CHORDS portals serve `/instruments/<id>.<csv|json|geojson|xml>` and
 * `/api/v1/data/<id>.<format>` with `start`/`end`. The CSV is GeoCSV: `#` comment
 * lines, then a header row (`time` first) and one row per timestamp. The portal
 * documentation does not pin down the JSON layout, so the JSON reader is
 * deliberately tolerant: it finds the array of observations and accepts
 * `{time, measurements:{…}}`, `{at, values:{…}}`, flat `{time, t1, rh1}` objects
 * and GeoJSON features.
 */
import { METRIC_NAME } from "./metrics.ts";

export type Observation = { t: number; values: Record<string, number> };

const TIME_KEYS = ["time", "at", "timestamp", "datetime", "date", "measured_at"];

/** `Temperature (degC)` / `t1[C]` / `T1` → `t1`-style shortname, or null if unusable. */
export function shortnameOf(header: string): string | null {
  const token = header
    .trim()
    .toLowerCase()
    .split(/[\s([{]/)[0]
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  return METRIC_NAME.test(token) ? token : null;
}

/** ISO times without a zone are UTC, as on a CHORDS portal. */
export function parseTimestamp(raw: unknown): number | null {
  if (typeof raw === "number") {
    const ms = raw < 1e11 ? raw * 1000 : raw;
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const withZone = /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
  const ms = Date.parse(withZone);
  return Number.isFinite(ms) ? ms : null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseChordsCsv(text: string): Observation[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  const timeCol = header.findIndex((h) => TIME_KEYS.includes(h.trim().toLowerCase()));
  if (timeCol < 0) return [];
  const names = header.map((h, i) => (i === timeCol ? null : shortnameOf(h)));
  const out: Observation[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const t = parseTimestamp(cells[timeCol]);
    if (t === null) continue;
    const values: Record<string, number> = {};
    cells.forEach((cell, i) => {
      const name = names[i];
      if (!name || cell.trim() === "") return;
      const v = Number(cell);
      if (Number.isFinite(v)) values[name] = v;
    });
    if (Object.keys(values).length) out.push({ t, values });
  }
  return out;
}

function findObservationArray(doc: unknown): unknown[] | null {
  if (Array.isArray(doc)) return doc;
  if (!doc || typeof doc !== "object") return null;
  const obj = doc as Record<string, unknown>;
  for (const key of ["data", "Data", "measurements", "Measurements", "features", "observations"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  for (const v of Object.values(obj)) {
    const inner = Array.isArray(v) ? v : null;
    if (inner && inner.length && typeof inner[0] === "object") return inner;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const deeper = findObservationArray(v);
      if (deeper) return deeper;
    }
  }
  return null;
}

export function parseChordsJson(text: string): Observation[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const items = findObservationArray(doc);
  if (!items) return [];
  const out: Observation[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    let item = raw as Record<string, unknown>;
    if (item.properties && typeof item.properties === "object") item = item.properties as Record<string, unknown>; // GeoJSON
    const timeKey = Object.keys(item).find((k) => TIME_KEYS.includes(k.toLowerCase()));
    const t = timeKey ? parseTimestamp(item[timeKey]) : null;
    if (t === null) continue;
    const nested = [item.measurements, item.values, item.Measurements].find(
      (v) => v && typeof v === "object" && !Array.isArray(v),
    ) as Record<string, unknown> | undefined;
    const source = nested ?? item;
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(source)) {
      if (source === item && k === timeKey) continue;
      const name = shortnameOf(k);
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
      if (name && Number.isFinite(n)) values[name] = n;
    }
    if (Object.keys(values).length) out.push({ t, values });
  }
  return out;
}

/** Try the format the server says it sent, then the other. */
export function parseChordsData(text: string, contentType = ""): Observation[] {
  const jsonFirst = /json/i.test(contentType) || /^\s*[[{]/.test(text);
  const first = jsonFirst ? parseChordsJson(text) : parseChordsCsv(text);
  if (first.length) return first;
  return jsonFirst ? parseChordsCsv(text) : parseChordsJson(text);
}

// ── writing ──────────────────────────────────────────────────────────────────

export type Flat = { time: string | Date; metric: string; value: number };

/** One row per timestamp, one column per variable (the shape CHORDS CSV/JSON use). */
export function pivot(rows: Flat[]): { columns: string[]; observations: { time: string; values: Record<string, number> }[] } {
  const byTime = new Map<string, Record<string, number>>();
  const columns = new Set<string>();
  for (const r of rows) {
    const time = (r.time instanceof Date ? r.time : new Date(r.time)).toISOString();
    const row = byTime.get(time) ?? {};
    row[r.metric] = r.value;
    byTime.set(time, row);
    columns.add(r.metric);
  }
  const observations = [...byTime.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([time, values]) => ({ time, values }));
  return { columns: [...columns].sort(), observations };
}

/** GeoCSV: `#` metadata, then `time,<var>,…`. */
export function toGeoCsv(
  meta: { name: string; latitude?: number | null; longitude?: number | null; units?: Record<string, string> },
  rows: Flat[],
): string {
  const { columns, observations } = pivot(rows);
  const head = [
    "# dataset: GeoCSV 2.0",
    "# delimiter: ,",
    `# title: ${meta.name.replace(/[\r\n]+/g, " ")}`,
    ...(meta.latitude != null && meta.longitude != null ? [`# latitude: ${meta.latitude}`, `# longitude: ${meta.longitude}`] : []),
    `# field_unit: ISO_8601${columns.map((c) => `,${meta.units?.[c] ?? ""}`).join("")}`,
    `# field_type: datetime${columns.map(() => ",float").join("")}`,
  ];
  const lines = observations.map((o) => [o.time, ...columns.map((c) => (c in o.values ? String(o.values[c]) : ""))].join(","));
  return [...head, ["time", ...columns].join(","), ...lines].join("\n") + "\n";
}

export function toChordsJson(
  instrument: { id: number; name: string; slug: string; latitude: number | null; longitude: number | null },
  variables: { shortname: string; name: string; units: string }[],
  rows: Flat[],
) {
  const { observations } = pivot(rows);
  return {
    instrument,
    variables,
    data: observations.map((o) => ({ time: o.time, measurements: o.values })),
  };
}

/**
 * Portals often hold sloppy coordinates (a dropped minus sign, longitude copied from latitude).
 * Sites named like "CO/thornton" are US ones, so a point outside the continental US is repaired
 * when flipping the sign fixes it, and dropped otherwise. Nothing is ever invented.
 */
const inUs = (lat: number, lon: number) => lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66;
export function fixUsPosition(site: string | null, lat: number, lon: number): { lat: number; lon: number } | null {
  const state = /^([A-Za-z]{2})\//.exec(site ?? "")?.[1]?.toUpperCase();
  if (!state || state === "AK" || state === "HI") return { lat, lon };
  if (inUs(lat, lon)) return { lat, lon };
  if (inUs(lat, -lon)) return { lat, lon: -lon };
  return null;
}
