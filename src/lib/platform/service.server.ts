/** Platform data access (server-only). Every function here is called behind a middleware that has already verified the caller. */
import { getSql } from "@/lib/db";
import { forgetKeys, ingestStats } from "./ingest.server";
import { newStationKey, slugify } from "./keys.server";
import { RANGES, type Range } from "./metrics";

export type Role = "user" | "admin" | "superadmin";
export type Profile = { userId: string; email: string; name: string; role: Role; suspended: boolean };

/** Anyone above a plain user: may use the admin console. */
export const isStaff = (role: Role) => role !== "user";

const emails = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/**
 * Create the caller's profile on first sight and resolve their role.
 * SUPERADMIN_EMAILS / ADMIN_EMAILS (comma lists) decide staff accounts. When
 * neither is set, the very first account to register becomes the super-admin so
 * a fresh install is never locked out. The environment can promote an account
 * but never demotes one; demotion is done in the console by a super-admin.
 */
export async function ensureProfile(userId: string): Promise<Profile> {
  const sql = await getSql();
  const users = await sql<{ email: string; name: string }>`select email, name from "user" where id = ${userId}`;
  const u = users[0];
  if (!u) throw new Error("Unknown user");
  const email = u.email.toLowerCase();
  const supers = emails("SUPERADMIN_EMAILS");
  const admins = emails("ADMIN_EMAILS");
  const isSuper = supers.includes(email);
  const isAdmin = admins.includes(email);
  const unconfigured = supers.length === 0 && admins.length === 0;
  await sql`
    insert into profiles (user_id, email, name, role)
    values (${userId}, ${u.email}, ${u.name},
      case when ${isSuper} then 'superadmin'
           when ${isAdmin} then 'admin'
           when ${unconfigured} and not exists (select 1 from profiles where role <> 'user') then 'superadmin'
           else 'user' end)
    on conflict (user_id) do nothing`;
  if (isSuper) await sql`update profiles set role = 'superadmin' where user_id = ${userId} and role <> 'superadmin'`;
  else if (isAdmin) await sql`update profiles set role = 'admin' where user_id = ${userId} and role = 'user'`;
  const rows = await sql<{ user_id: string; email: string; name: string; role: Role; suspended: boolean }>`
    select user_id, email, name, role, suspended from profiles where user_id = ${userId}`;
  const p = rows[0];
  return { userId: p.user_id, email: p.email, name: p.name, role: p.role, suspended: p.suspended };
}

export async function audit(actor: string | null, action: string, target: string | null, detail: object = {}) {
  const sql = await getSql();
  await sql`insert into audit_log (actor_id, action, target, detail) values (${actor}, ${action}, ${target}, ${JSON.stringify(detail)}::jsonb)`;
}

// ── plans ────────────────────────────────────────────────────────────────────

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type PlanRow = {
  id: string;
  name: string;
  config_id: string | null;
  station_count: number;
  updated_at: string;
};

export async function listPlans(userId: string) {
  const sql = await getSql();
  return sql<PlanRow>`select id, name, config_id, station_count, updated_at from plans where user_id = ${userId} order by updated_at desc limit 100`;
}

export async function getPlan(userId: string, id: string) {
  const sql = await getSql();
  const rows = await sql<PlanRow & { data: Json }>`select id, name, config_id, station_count, data, updated_at from plans where id = ${id} and user_id = ${userId}`;
  return rows[0] ?? null;
}

export async function savePlan(
  userId: string,
  input: { id?: string; name: string; configId: string | null; stationCount: number; data: unknown },
) {
  const sql = await getSql();
  const json = JSON.stringify(input.data);
  if (input.id) {
    const rows = await sql<{ id: string }>`
      update plans set name = ${input.name}, config_id = ${input.configId}, station_count = ${input.stationCount},
        data = ${json}::jsonb, updated_at = now()
      where id = ${input.id} and user_id = ${userId} returning id`;
    if (rows[0]) return rows[0].id;
  }
  const rows = await sql<{ id: string }>`
    insert into plans (user_id, name, config_id, station_count, data)
    values (${userId}, ${input.name}, ${input.configId}, ${input.stationCount}, ${json}::jsonb) returning id`;
  return rows[0].id;
}

export async function deletePlan(userId: string, id: string) {
  const sql = await getSql();
  await sql`delete from plans where id = ${id} and user_id = ${userId}`;
}

// ── stations ─────────────────────────────────────────────────────────────────

export const STATION_COLS = `id, owner_id, plan_id, slug, name, description, latitude, longitude, elevation_m,
  config_id, link, expected_metrics, status, is_public, api_key_hint, rate_limit_per_min,
  last_seen_at, last_values, created_at, chords_id, strict_metrics, source, remote, ncar_network, ncar_joined_at, gateway_id`;

export type StationRow = {
  id: string;
  owner_id: string;
  plan_id: string | null;
  slug: string;
  name: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  elevation_m: number | null;
  config_id: string | null;
  link: string | null;
  expected_metrics: string[];
  status: "active" | "disabled";
  is_public: boolean;
  api_key_hint: string;
  rate_limit_per_min: number;
  last_seen_at: string | null;
  last_values: Record<string, { v: number; t: string }>;
  created_at: string;
  chords_id: number;
  ncar_network: boolean;
  ncar_joined_at: string | null;
  gateway_id: string | null;
  strict_metrics: boolean;
  source: "device" | "chords";
  remote: {
    portal: string;
    instrumentId: number;
    lastSync?: string | null;
    nextSync?: string | null;
    everyMin?: number;
    lastError?: string | null;
  } | null;
};

export async function listStations(ownerId: string) {
  const sql = await getSql();
  return sql.query<StationRow>(`select ${STATION_COLS} from stations where owner_id = $1 order by created_at desc`, [ownerId]);
}

export async function listPublicStations() {
  const sql = await getSql();
  return sql.query<StationRow>(
    `select ${STATION_COLS} from stations where is_public and status = 'active' order by last_seen_at desc nulls last limit 200`,
  );
}

/** A station the viewer may see: owner, admin, or anyone when it is public. */
export async function getStationFor(slug: string, viewer: { userId: string; role: Role } | null) {
  const sql = await getSql();
  const rows = await sql.query<StationRow>(`select ${STATION_COLS} from stations where slug = $1`, [slug]);
  const s = rows[0];
  if (!s) return null;
  const allowed = s.is_public || (viewer && (viewer.role === "admin" || viewer.userId === s.owner_id));
  return allowed ? s : null;
}

export type NewStation = {
  name: string;
  description?: string;
  planId?: string | null;
  configId?: string | null;
  link?: string | null;
  expectedMetrics?: string[];
  latitude?: number | null;
  longitude?: number | null;
  ncarNetwork?: boolean;
};

/** Create stations and return each with its one-time API key. */
export async function createStations(ownerId: string, items: NewStation[]) {
  const sql = await getSql();
  const out: { station: StationRow; apiKey: string }[] = [];
  for (const item of items) {
    const k = newStationKey();
    const rows = await sql.query<StationRow>(
      `insert into stations (owner_id, plan_id, slug, name, description, config_id, link, expected_metrics,
         latitude, longitude, api_key_hash, api_key_hint, ncar_network, ncar_joined_at, is_public)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, case when $13::bool then now() end, $13::bool) returning ${STATION_COLS}`,
      [
        ownerId,
        item.planId ?? null,
        slugify(item.name),
        item.name,
        item.description ?? "",
        item.configId ?? null,
        item.link ?? null,
        item.expectedMetrics ?? [],
        item.latitude ?? null,
        item.longitude ?? null,
        k.hash,
        k.hint,
        item.ncarNetwork ?? false,
      ],
    );
    out.push({ station: rows[0], apiKey: k.key });
  }
  await audit(ownerId, "station.create", null, { count: items.length });
  return out;
}

export async function updateStation(
  actor: { userId: string; role: Role },
  id: string,
  patch: {
    name?: string;
    description?: string;
    isPublic?: boolean;
    ncarNetwork?: boolean;
    gatewayId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    status?: "active" | "disabled";
    rateLimitPerMin?: number;
    ownerId?: string;
  },
) {
  const sql = await getSql();
  const admin = isStaff(actor.role);
  if (patch.isPublic || patch.ncarNetwork) {
    // An imported CHORDS instrument is a private view of someone else's data. It stays in the importer's account.
    const [src] = await sql.query<{ source: string }>("select source from stations where id = $1", [id]);
    if (src?.source === "chords") throw new Error("Imported CHORDS stations stay private. Their data belongs to the portal that publishes it");
  }
  if (patch.ncarNetwork) {
    // The network map and the research hub place a station by its coordinates, so joining needs them.
    const [s] = await sql.query<{ latitude: number | null; longitude: number | null }>(
      "select latitude, longitude from stations where id = $1 and ($2::bool or owner_id = $3)",
      [id, admin, actor.userId],
    );
    const lat = patch.latitude !== undefined ? patch.latitude : s?.latitude;
    const lon = patch.longitude !== undefined ? patch.longitude : s?.longitude;
    if (s && (lat == null || lon == null)) throw new Error("Set the station's location before joining the NCAR network");
  }
  // Owners edit descriptive fields; only admins change status, limits and ownership.
  const rows = await sql.query<{ id: string }>(
    `update stations set
       name = coalesce($3, name),
       description = coalesce($4, description),
       is_public = case when $13::bool then true else coalesce($5, is_public) end,
       ncar_joined_at = case when $13::bool and not ncar_network then now() when $13::bool = false then null else ncar_joined_at end,
       ncar_network = coalesce($13::bool, ncar_network),
       gateway_id = case when $14::bool then nullif($15, '') else gateway_id end,
       latitude = case when $6::bool then $7 else latitude end,
       longitude = case when $6::bool then $8 else longitude end,
       status = case when $2::bool then coalesce($9, status) else status end,
       rate_limit_per_min = case when $2::bool then coalesce($10, rate_limit_per_min) else rate_limit_per_min end,
       owner_id = case when $2::bool then coalesce($11, owner_id) else owner_id end
     where id = $1 and ($2::bool or owner_id = $12) returning id`,
    [
      id,
      admin,
      patch.name ?? null,
      patch.description ?? null,
      patch.isPublic ?? null,
      patch.latitude !== undefined || patch.longitude !== undefined,
      patch.latitude ?? null,
      patch.longitude ?? null,
      patch.status ?? null,
      patch.rateLimitPerMin ?? null,
      patch.ownerId ?? null,
      actor.userId,
      patch.ncarNetwork ?? null,
      patch.gatewayId !== undefined,
      patch.gatewayId ?? null,
    ],
  );
  if (!rows[0]) throw new Error("Station not found");
  forgetKeys();
  await audit(actor.userId, "station.update", id, patch);
}

export async function rotateKey(actor: { userId: string; role: Role }, id: string) {
  const sql = await getSql();
  const k = newStationKey();
  const rows = await sql<{ id: string }>`
    update stations set api_key_hash = ${k.hash}, api_key_hint = ${k.hint}
    where id = ${id} and (${isStaff(actor.role)} or owner_id = ${actor.userId}) returning id`;
  if (!rows[0]) throw new Error("Station not found");
  forgetKeys();
  await audit(actor.userId, "station.rotate_key", id);
  return k.key;
}

export async function deleteStation(actor: { userId: string; role: Role }, id: string) {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`
    delete from stations where id = ${id} and (${isStaff(actor.role)} or owner_id = ${actor.userId}) returning id`;
  if (!rows[0]) throw new Error("Station not found");
  await sql`delete from measurements where station_id = ${id}`;
  forgetKeys();
  await audit(actor.userId, "station.delete", id);
}

// ── series ───────────────────────────────────────────────────────────────────

export type SeriesPoint = { t: string; avg: number; min: number; max: number };

/** Pick raw rows for short windows and the hourly rollup for long ones, bucketed so a chart never gets more than ~300 points. */
export async function stationSeries(stationId: string, metric: string, range: Range): Promise<SeriesPoint[]> {
  const sql = await getSql();
  const hours = RANGES[range].hours;
  const from = new Date(Date.now() - hours * 3600_000);
  const bucketSec = Math.max(60, Math.ceil((hours * 3600) / 300 / 60) * 60);
  if (hours <= 48) {
    return sql.query<SeriesPoint>(
      `select date_bin($1::interval, time, timestamptz '2000-01-01') as t,
              avg(value) as avg, min(value) as min, max(value) as max
       from measurements where station_id = $2 and metric = $3 and time >= $4
       group by 1 order by 1`,
      [`${bucketSec} seconds`, stationId, metric, from],
    );
  }
  return sql.query<SeriesPoint>(
    `select date_bin($1::interval, bucket, timestamptz '2000-01-01') as t,
            sum(avg * n) / sum(n) as avg, min(min) as min, max(max) as max
     from measurements_hourly where station_id = $2 and metric = $3 and bucket >= $4
     group by 1 order by 1`,
    [`${Math.max(3600, bucketSec)} seconds`, stationId, metric, from],
  );
}

export async function stationCsv(stationId: string, hours: number): Promise<string> {
  const sql = await getSql();
  const rows = await sql<{ time: string; metric: string; value: number }>`
    select time, metric, value from measurements
    where station_id = ${stationId} and time >= ${new Date(Date.now() - hours * 3600_000)}
    order by time desc limit 200000`;
  return ["time,metric,value", ...rows.map((r) => `${new Date(r.time).toISOString()},${r.metric},${r.value}`)].join("\n");
}

// ── admin ────────────────────────────────────────────────────────────────────

export async function adminOverview() {
  const sql = await getSql();
  const [counts] = await sql<{
    stations: number;
    active: number;
    online: number;
    users: number;
    plans: number;
    rows_24h: number;
    rows_total: number;
  }>`
    select
      (select count(*) from stations) as stations,
      (select count(*) from stations where status = 'active') as active,
      (select count(*) from stations where last_seen_at > now() - interval '15 minutes') as online,
      (select count(*) from profiles) as users,
      (select count(*) from plans) as plans,
      (select count(*) from measurements where time > now() - interval '24 hours') as rows_24h,
      (select count(*) from measurements) as rows_total`;
  const timescale = (await sql<{ n: number }>`select count(*) as n from pg_extension where extname = 'timescaledb'`)[0].n > 0;
  const audit = await sql<{ id: number; at: string; actor_id: string | null; action: string; target: string | null }>`
    select id, at, actor_id, action, target from audit_log order by at desc limit 15`;
  return { ...counts, timescale, ingest: ingestStats(), audit };
}

export async function adminStations(q: string, status: string, limit: number, offset: number) {
  const sql = await getSql();
  return sql.query<StationRow & { owner_email: string | null }>(
    `select ${STATION_COLS.split(",").map((c) => `s.${c.trim()}`).join(", ")}, p.email as owner_email
     from stations s left join profiles p on p.user_id = s.owner_id
     where ($1 = '' or s.name ilike '%' || $1 || '%' or s.slug ilike '%' || $1 || '%' or p.email ilike '%' || $1 || '%')
       and ($2 = '' or s.status = $2)
     order by s.created_at desc limit $3 offset $4`,
    [q, status, limit, offset],
  );
}

export async function adminUsers() {
  const sql = await getSql();
  return sql<{ user_id: string; email: string; name: string; role: Role; suspended: boolean; created_at: string; stations: number; plans: number }>`
    select p.user_id, p.email, p.name, p.role, p.suspended, p.created_at,
      (select count(*) from stations s where s.owner_id = p.user_id) as stations,
      (select count(*) from plans l where l.user_id = p.user_id) as plans
    from profiles p order by p.created_at desc limit 500`;
}

// ── user management ──────────────────────────────────────────────────────────

export type UserAction =
  | "suspend"
  | "restore"
  | "make_admin"
  | "remove_admin"
  | "revoke_sessions"
  | "reset_password"
  | "delete";

/**
 * Who may act on whom. Admins manage plain users. Only a super-admin touches
 * admins. Nobody manages themselves here, and super-admins are managed only
 * through the environment (SUPERADMIN_EMAILS), so the last one can't be removed.
 */
async function manageable(actor: { userId: string; role: Role }, userId: string) {
  if (userId === actor.userId) throw new Error("You can't change your own account from the console");
  const sql = await getSql();
  const rows = await sql<{ user_id: string; email: string; role: Role }>`select user_id, email, role from profiles where user_id = ${userId}`;
  const t = rows[0];
  if (!t) throw new Error("User not found");
  if (t.role === "superadmin") throw new Error("Super-admins can't be changed from the console");
  if (t.role === "admin" && actor.role !== "superadmin") throw new Error("Only a super-admin can manage administrators");
  return t;
}

export async function adminUserAction(
  actor: { userId: string; role: Role },
  userId: string,
  action: UserAction,
): Promise<{ tempPassword?: string }> {
  const sql = await getSql();
  const t = await manageable(actor, userId);
  let out: { tempPassword?: string } = {};
  switch (action) {
    case "suspend":
      await sql`update profiles set suspended = true where user_id = ${userId}`;
      await sql`delete from "session" where "userId" = ${userId}`;
      break;
    case "restore":
      await sql`update profiles set suspended = false where user_id = ${userId}`;
      break;
    case "make_admin":
    case "remove_admin":
      if (actor.role !== "superadmin") throw new Error("Only a super-admin can change roles");
      await sql`update profiles set role = ${action === "make_admin" ? "admin" : "user"} where user_id = ${userId}`;
      break;
    case "revoke_sessions":
      await sql`delete from "session" where "userId" = ${userId}`;
      break;
    case "reset_password": {
      const { randomBytes } = await import("node:crypto");
      const { auth } = await import("@/lib/auth/server");
      const temp = randomBytes(9).toString("base64url");
      const ctx = await auth.$context;
      const hash = await ctx.password.hash(temp);
      const done = await sql<{ id: string }>`update "account" set password = ${hash} where "userId" = ${userId} and "providerId" = 'credential' returning id`;
      if (!done[0]) throw new Error("This person signs in another way and has no password to reset");
      await sql`delete from "session" where "userId" = ${userId}`;
      out = { tempPassword: temp };
      break;
    }
    case "delete":
      await sql`delete from measurements where station_id in (select id from stations where owner_id = ${userId})`;
      await sql`delete from stations where owner_id = ${userId}`;
      await sql`delete from plans where user_id = ${userId}`;
      await sql`delete from profiles where user_id = ${userId}`;
      await sql`delete from "user" where id = ${userId}`; // sessions + accounts cascade
      forgetKeys();
      break;
  }
  await audit(actor.userId, `user.${action}`, userId, { email: t.email });
  return out;
}

export async function adminUserDetail(userId: string) {
  const sql = await getSql();
  const stations = await sql<{ slug: string; name: string; status: string; last_seen_at: string | null }>`
    select slug, name, status, last_seen_at from stations where owner_id = ${userId} order by created_at desc limit 50`;
  const plans = await sql<{ id: string; name: string; updated_at: string }>`
    select id, name, updated_at from plans where user_id = ${userId} order by updated_at desc limit 50`;
  const sessions = await sql<{ n: number }>`select count(*) as n from "session" where "userId" = ${userId} and "expiresAt" > now()`;
  return { stations, plans, activeSessions: sessions[0].n };
}

// ── network map ──────────────────────────────────────────────────────────────

export type MapStation = {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation_m: number | null;
  state: "online" | "delayed" | "offline" | "waiting";
  last_seen_at: string | null;
  ncar: boolean;
  mine: boolean;
  source: "device" | "chords";
  remote: { portal: string; instrumentId: number } | null;
  values: Record<string, { v: number; t: string }>;
};

const ONLINE_MS = 15 * 60_000;
const DELAYED_MS = 6 * 3600_000;

export function stationState(lastSeen: string | null, now = Date.now()): MapStation["state"] {
  if (!lastSeen) return "waiting";
  const age = now - new Date(lastSeen).getTime();
  return age <= ONLINE_MS ? "online" : age <= DELAYED_MS ? "delayed" : "offline";
}

/**
 * Everything the map may draw for this viewer: shared stations, plus the viewer's own.
 * Coordinates are published as given, so owners should place a station where they are happy to show it.
 */
export async function mapStations(viewer: { userId: string; role: Role } | null): Promise<MapStation[]> {
  const sql = await getSql();
  const rows = await sql.query<StationRow>(
    `select ${STATION_COLS} from stations
     where latitude is not null and longitude is not null and status = 'active'
       and (is_public or ($1::text is not null and owner_id = $1))
     order by last_seen_at desc nulls last limit 2000`,
    [viewer?.userId ?? null],
  );
  const now = Date.now();
  return rows.map((s) => ({
    slug: s.slug,
    name: s.name,
    latitude: s.latitude as number,
    longitude: s.longitude as number,
    elevation_m: s.elevation_m,
    state: stationState(s.last_seen_at, now),
    last_seen_at: s.last_seen_at,
    ncar: s.ncar_network,
    mine: Boolean(viewer && s.owner_id === viewer.userId),
    source: s.source,
    remote: s.remote ? { portal: s.remote.portal, instrumentId: s.remote.instrumentId } : null,
    values: s.last_values ?? {},
  }));
}

/** A station's position, as reported by the device itself (gateway position packets). */
export async function setStationPosition(
  stationId: string,
  p: { latitude?: number; longitude?: number; elevation?: number },
) {
  const sql = await getSql();
  await sql.query(
    `update stations set latitude = coalesce($2, latitude), longitude = coalesce($3, longitude),
       elevation_m = coalesce($4, elevation_m) where id = $1`,
    [stationId, p.latitude ?? null, p.longitude ?? null, p.elevation ?? null],
  );
}

// ── database console (admin) ─────────────────────────────────────────────────

/** Tables staff may browse. Secret columns (key hashes, remote keys) are never selected. */
export const BROWSABLE: Record<string, { columns: string[]; order: string }> = {
  stations: {
    columns: ["slug", "name", "owner_id", "status", "is_public", "ncar_network", "latitude", "longitude", "source", "last_seen_at", "created_at"],
    order: "created_at desc",
  },
  profiles: { columns: ["email", "name", "role", "suspended", "created_at"], order: "created_at desc" },
  plans: { columns: ["name", "user_id", "config_id", "station_count", "updated_at"], order: "updated_at desc" },
  measurements: { columns: ["time", "station_id", "metric", "value"], order: "time desc" },
  audit_log: { columns: ["at", "actor_id", "action", "target"], order: "at desc" },
  variables: { columns: ["shortname", "name", "units", "category", "builtin"], order: "shortname asc" },
  forecast_runs: { columns: ["id", "station_id", "status", "backend", "lead_hours", "created_at"], order: "created_at desc" },
  credit_forecasts: { columns: ["station_id", "variable", "init_time", "valid_time", "value"], order: "valid_time desc" },
  data_consent: { columns: ["owner_id", "station_id", "steward", "scope", "gdex", "recorded_at"], order: "recorded_at desc" },
  collective_members: { columns: ["name", "area", "offers", "created_at"], order: "created_at desc" },
};

export async function adminDatabase() {
  const sql = await getSql();
  const tables: { name: string; rows: number }[] = [];
  for (const name of Object.keys(BROWSABLE)) {
    try {
      const [r] = await sql.query<{ n: number }>(`select count(*)::int as n from ${name}`);
      tables.push({ name, rows: r.n });
    } catch {
      /* a table from a migration that has not run yet */
    }
  }
  const [size] = await sql.query<{ bytes: number }>(`select pg_database_size(current_database())::float8 as bytes`).catch(() => [{ bytes: 0 }]);
  const [range] = await sql.query<{ first: string | null; last: string | null }>(
    `select min(time) as first, max(time) as last from measurements`,
  );
  const [ver] = await sql.query<{ v: string }>(`select version() as v`);
  return { tables, bytes: size?.bytes ?? 0, first: range?.first ?? null, last: range?.last ?? null, version: ver.v };
}

export async function adminTableRows(table: string, limit: number, offset: number) {
  const t = BROWSABLE[table];
  if (!t) throw new Error("Unknown table");
  const sql = await getSql();
  const rows = await sql.query<Record<string, unknown>>(
    `select ${t.columns.join(", ")} from ${table} order by ${t.order} limit $1 offset $2`,
    [Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)],
  );
  // Everything crosses the wire as display text, so dates, arrays and booleans all render the same way.
  const show = (v: unknown): string =>
    v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(", ") : String(v);
  return {
    columns: t.columns,
    rows: rows.map((r) => Object.fromEntries(t.columns.map((c) => [c, show(r[c])])) as Record<string, string>),
  };
}
