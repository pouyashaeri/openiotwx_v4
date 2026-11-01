/** Variables catalog, per-station parameters, CHORDS import, and the data behind the CHORDS-compatible read API. */
import { getSql } from "@/lib/db";
import { forgetKeys } from "./ingest.server";
import { hashKey, newStationKey, slugify } from "./keys.server";
import { normalizePortal, seal, startChordsSync, syncStation } from "./chords-remote.server";
import { METRIC_NAME } from "./metrics";
import { audit, isStaff, STATION_COLS, type Role, type StationRow } from "./service.server";

startChordsSync();

// ── variables ────────────────────────────────────────────────────────────────

export type Variable = { shortname: string; name: string; units: string; category: string; builtin: boolean };

export async function listVariables(): Promise<Variable[]> {
  const sql = await getSql();
  return sql<Variable>`select shortname, name, units, category, builtin from variables order by category, name`;
}

export async function addVariable(userId: string, v: { shortname: string; name: string; units: string; category: string }) {
  if (!METRIC_NAME.test(v.shortname)) {
    throw new Error("A shortname starts with a letter and uses lowercase letters, digits and underscores (e.g. leaf_wetness)");
  }
  const sql = await getSql();
  const rows = await sql<{ shortname: string }>`
    insert into variables (shortname, name, units, category, created_by)
    values (${v.shortname}, ${v.name}, ${v.units}, ${v.category || "other"}, ${userId})
    on conflict (shortname) do nothing returning shortname`;
  if (!rows[0]) throw new Error(`"${v.shortname}" already exists`);
  await audit(userId, "variable.add", v.shortname);
}

export async function deleteVariable(actor: { userId: string; role: Role }, shortname: string) {
  if (!isStaff(actor.role)) throw new Error("Not found");
  const sql = await getSql();
  const rows = await sql<{ shortname: string }>`delete from variables where shortname = ${shortname} and not builtin returning shortname`;
  if (!rows[0]) throw new Error("Built-in variables can't be removed");
  await audit(actor.userId, "variable.delete", shortname);
}

/** Choose which variables a station reports; `strict` makes uploads outside the list get rejected. */
export async function setStationParams(
  actor: { userId: string; role: Role },
  id: string,
  p: { metrics: string[]; strict: boolean },
) {
  const metrics = [...new Set(p.metrics)].filter((m) => METRIC_NAME.test(m)).slice(0, 64);
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    update stations set expected_metrics = ${metrics}::text[], strict_metrics = ${p.strict && metrics.length > 0}
    where id = ${id} and source = 'device' and (${isStaff(actor.role)} or owner_id = ${actor.userId}) returning id`;
  if (!rows[0]) throw new Error("Station not found");
  forgetKeys();
  await audit(actor.userId, "station.params", id, { count: metrics.length, strict: p.strict });
}

// ── importing from another CHORDS portal ─────────────────────────────────────

export async function importFromChords(
  ownerId: string,
  p: {
    portal: string;
    instrumentId: number;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    email?: string;
    apiKey?: string;
    everyMin?: number;
    isPublic?: boolean;
  },
): Promise<{ station: StationRow; rows: number; warning: string | null }> {
  const sql = await getSql();
  const portal = normalizePortal(p.portal);
  const dup = await sql<{ slug: string }>`
    select slug from stations where owner_id = ${ownerId} and source = 'chords'
      and remote->>'portal' = ${portal} and (remote->>'instrumentId')::int = ${p.instrumentId}`;
  if (dup[0]) throw new Error("You already imported this instrument");
  const k = newStationKey(); // imported stations never receive uploads; the key just fills the required column
  const remote = {
    portal,
    instrumentId: p.instrumentId,
    email: p.email || undefined,
    everyMin: Math.min(1440, Math.max(5, p.everyMin ?? 15)),
    lastSync: null,
    nextSync: null,
    lastError: null,
  };
  const rows = await sql.query<StationRow>(
    `insert into stations (owner_id, slug, name, latitude, longitude, api_key_hash, api_key_hint,
       source, remote, remote_key, is_public, description)
     values ($1, $2, $3, $4, $5, $6, 'chords', 'chords', $7::jsonb, $8, $9, $10) returning ${STATION_COLS}`,
    [
      ownerId,
      slugify(p.name),
      p.name,
      p.latitude ?? null,
      p.longitude ?? null,
      hashKey(k.key),
      JSON.stringify(remote),
      p.apiKey ? seal(p.apiKey) : null,
      false, // a view of the portal's data, never republished from here
      `Imported from ${portal}, instrument ${p.instrumentId}`,
    ],
  );
  const station = rows[0];
  await audit(ownerId, "station.chords_import", station.id, { portal, instrumentId: p.instrumentId });
  let count = 0;
  let warning: string | null = null;
  try {
    count = (await syncStation(station.id)).rows;
  } catch (e) {
    warning = e instanceof Error ? e.message : "The first download failed";
  }
  const fresh = await sql.query<StationRow>(`select ${STATION_COLS} from stations where id = $1`, [station.id]);
  return { station: fresh[0], rows: count, warning };
}

export async function syncNow(actor: { userId: string; role: Role }, id: string) {
  const sql = await getSql();
  const ok = await sql<{ id: string }>`select id from stations where id = ${id} and source = 'chords' and (${isStaff(actor.role)} or owner_id = ${actor.userId})`;
  if (!ok[0]) throw new Error("Station not found");
  return syncStation(id);
}

// ── CHORDS-compatible read API ───────────────────────────────────────────────

/** Whoever may read a station's data: its owner, staff, anyone when public, or a holder of its upload key. */
export async function readableByChordsId(
  chordsId: number,
  viewer: { userId: string; role: Role } | null,
  apiKey: string | null,
): Promise<(StationRow & { api_key_hash: string }) | null> {
  const sql = await getSql();
  const rows = await sql.query<StationRow & { api_key_hash: string }>(
    `select ${STATION_COLS}, api_key_hash from stations where chords_id = $1`,
    [chordsId],
  );
  const s = rows[0];
  if (!s) return null;
  const allowed =
    (s.is_public && s.status === "active") ||
    (viewer && (isStaff(viewer.role) || viewer.userId === s.owner_id)) ||
    (apiKey && s.source === "device" && hashKey(apiKey) === s.api_key_hash);
  return allowed ? s : null;
}

export async function publicInstruments() {
  const sql = await getSql();
  return sql<{ chords_id: number; name: string; slug: string; latitude: number | null; longitude: number | null; expected_metrics: string[] }>`
    select chords_id, name, slug, latitude, longitude, expected_metrics from stations
    where is_public and status = 'active' order by chords_id`;
}

export type ExportRow = { time: Date; metric: string; value: number };

export async function exportRows(stationId: string, from: Date, to: Date, limit = 500_000): Promise<ExportRow[]> {
  const sql = await getSql();
  return sql<ExportRow>`
    select time, metric, value from measurements
    where station_id = ${stationId} and time >= ${from} and time <= ${to}
    order by time asc limit ${limit}`;
}

export async function variableInfo(shortnames: string[]) {
  const sql = await getSql();
  return sql<{ shortname: string; name: string; units: string }>`
    select shortname, name, units from variables where shortname = any(${shortnames}::text[])`;
}
