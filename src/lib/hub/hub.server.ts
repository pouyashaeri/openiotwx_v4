/**
 * The community hub (server-only): the API that v3's pages talk to, served by this app from
 * this app's database at /hub. It keeps v3's route shapes, so the same pages also work
 * against a standalone v3 stack (see infra/), and v3's own services can attach to it.
 *
 * What differs from v3's open server: this one has accounts. Anyone can read what is public;
 * writes need a signed-in person, and the services that fill in forecasts present HUB_TOKEN.
 */
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/verify.server";
import { ensureProfile, isStaff, type Role } from "@/lib/platform/service.server";

const VERSION = "3.0.0-hub";
const BOINC_PROJECT_URL = () => (process.env.BOINC_PROJECT_URL ?? "").trim();
const CIRRUS_ENABLED = () => process.env.CIRRUS_ENABLED === "1";
const EJAM_URL = () => (process.env.EJAM_URL ?? "https://api.ejanalysis.com").replace(/\/+$/, "");

type Viewer = { userId: string; role: Role } | null;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, detail: string) => json({ detail }, status);

async function viewerOf(): Promise<Viewer> {
  const user = await getSessionUser().catch(() => null);
  if (!user) return null;
  const p = await ensureProfile(user.id).catch(() => null);
  return p && !p.suspended ? { userId: p.userId, role: p.role } : null;
}

/** The services that fill in forecasts and place data present a shared token instead of signing in. */
function hasToken(request: Request): boolean {
  const expected = process.env.HUB_TOKEN?.trim();
  const given = request.headers.get("x-hub-token") ?? "";
  return Boolean(expected) && given.length === expected!.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected!));
}

// Our variable names, in the names v3's pages understand (their MEASURE_TO_VAR keys).
const TO_V3: Record<string, string> = {
  temp_c: "temperature",
  humidity_pct: "humidity",
  pressure_hpa: "pressure",
  wind_ms: "wind_speed",
  wind_gust_ms: "wind_gust",
  rain_mm: "rain",
  pm25_ugm3: "pm25",
  soil_moisture_pct: "soil_moisture",
  co2_ppm: "co2",
  o3_ppb: "ozone",
};
const v3Name = (metric: string) => TO_V3[metric] ?? metric;

type StationRow = {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  is_public: boolean;
  status: string;
  latitude: number | null;
  longitude: number | null;
  elevation_m: number | null;
  config_id: string | null;
  last_seen_at: string | null;
  last_values: Record<string, { v: number; t: string }>;
};

const STATION_COLS = "id, slug, name, owner_id, is_public, status, latitude, longitude, elevation_m, config_id, last_seen_at, last_values";
const canSee = (s: StationRow, v: Viewer) => (s.is_public && s.status === "active") || Boolean(v && (isStaff(v.role) || v.userId === s.owner_id));

async function stationBySlug(slug: string, v: Viewer): Promise<StationRow | null> {
  const sql = await getSql();
  const rows = await sql.query<StationRow>(`select ${STATION_COLS} from stations where slug = $1`, [slug]);
  return rows[0] && canSee(rows[0], v) ? rows[0] : null;
}

const publicStation = (s: StationRow) => ({
  station_id: s.slug,
  device: s.config_id ? `Configuration ${s.config_id}` : null,
  latitude: s.latitude,
  longitude: s.longitude,
  altitude: s.elevation_m,
  organization: null,
  last_active: s.last_seen_at,
});

async function body<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const raw = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, res: fail(422, parsed.error.issues[0]?.message ?? "Invalid body") };
}

// One slow outside lookup at a time, and not a flood: the EJAM proxy takes up to a minute.
const ejLimiter = { at: [] as number[], busy: 0 };

export async function handleHub(request: Request, path: string): Promise<Response> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  const sql = await getSql();
  const route = parts.join("/");

  if (route === "health" && method === "GET") {
    let database = false;
    try {
      await sql`select 1`;
      database = true;
    } catch {
      /* reported below */
    }
    return json({ status: database ? "ok" : "degraded", version: VERSION, services: { database, boinc: Boolean(BOINC_PROJECT_URL()), cirrus: CIRRUS_ENABLED() } });
  }

  if (parts[0] !== "api") return fail(404, "Not found");
  const [, area, a, b] = parts;
  const viewer = await viewerOf();
  const trusted = hasToken(request) || Boolean(viewer && isStaff(viewer.role));

  // ── stations and readings ─────────────────────────────────────────────────
  if (area === "stations" && method === "GET") {
    if (a) {
      const s = await stationBySlug(a, viewer);
      return s ? json(publicStation(s)) : fail(404, "No such station");
    }
    const rows = await sql.query<StationRow>(
      `select ${STATION_COLS} from stations
       where (is_public and status = 'active') or ($1::text is not null and owner_id = $1) or $2::bool
       order by last_seen_at desc nulls last limit 500`,
      [viewer?.userId ?? null, Boolean(viewer && isStaff(viewer.role))],
    );
    return json(rows.map(publicStation));
  }

  if (area === "readings" && a && method === "GET") {
    const s = await stationBySlug(decodeURIComponent(a), viewer);
    if (!s) return fail(404, "No such station");
    const hours = Math.min(24 * 90, Math.max(1, Number(url.searchParams.get("hours")) || 72));
    // Hourly: v3's charts and decision cards read hours, not individual uploads. Rain adds up; the rest average.
    const rows = await sql.query<{ metric: string; v: number; ts: string }>(
      `select metric, case when metric like 'rain%' then sum(value) else avg(value) end as v, date_trunc('hour', time) as ts
       from measurements where station_id = $1 and time > now() - make_interval(hours => $2)
       group by metric, date_trunc('hour', time) order by ts asc`,
      [s.id, hours],
    );
    return json(rows.map((r) => ({ station_id: s.slug, measurement: v3Name(r.metric), reading_value: Number(r.v), sensor_model: null, timestamp: new Date(r.ts).toISOString() })));
  }

  if (area === "latest" && a && method === "GET") {
    const s = await stationBySlug(decodeURIComponent(a), viewer);
    if (!s) return fail(404, "No such station");
    return json(Object.entries(s.last_values).map(([metric, x]) => ({ measurement: v3Name(metric), reading_value: x.v, time: x.t })));
  }

  // ── forecasts ──────────────────────────────────────────────────────────────
  if (area === "credit-forecast") {
    if (a && method === "GET") {
      const s = await stationBySlug(decodeURIComponent(a), viewer);
      if (!s) return fail(404, "No such station");
      const rows = await sql.query<{ variable: string; valid_time: string; value: number; init_time: string; source: string }>(
        `select variable, valid_time, value, init_time, source from credit_forecasts
         where station_id = $1 and init_time = (select max(init_time) from credit_forecasts where station_id = $1)
         order by variable, valid_time`,
        [s.id],
      );
      return json(rows.map((r) => ({ station_id: s.slug, ...r })));
    }
    if (!a && method === "POST") {
      if (!trusted) return fail(401, "Forecast values come from the forecast service");
      const parsed = await body(
        request,
        z
          .array(
            z.object({
              run_id: z.number().int().nullable().optional(),
              station_id: z.string().max(80),
              variable: z.string().max(40),
              init_time: z.string(),
              valid_time: z.string(),
              value: z.number().finite(),
              source: z.string().max(20).default("credit"),
            }),
          )
          .max(5000),
      );
      if (!parsed.ok) return parsed.res;
      const slugs = [...new Set(parsed.data.map((r) => r.station_id))];
      const ids = await sql.query<{ id: string; slug: string }>(`select id, slug from stations where slug = any($1::text[])`, [slugs]);
      const byslug = new Map(ids.map((r) => [r.slug, r.id]));
      const rows = parsed.data.filter((r) => byslug.has(r.station_id));
      if (rows.length) {
        await sql.query(
          `insert into credit_forecasts (run_id, station_id, variable, init_time, valid_time, value, source)
           select * from unnest($1::bigint[], $2::uuid[], $3::text[], $4::timestamptz[], $5::timestamptz[], $6::float8[], $7::text[])
           on conflict (station_id, variable, init_time, valid_time, source) do update set value = excluded.value, run_id = excluded.run_id`,
          [
            rows.map((r) => r.run_id ?? null),
            rows.map((r) => byslug.get(r.station_id)),
            rows.map((r) => r.variable),
            rows.map((r) => new Date(r.init_time)),
            rows.map((r) => new Date(r.valid_time)),
            rows.map((r) => r.value),
            rows.map((r) => r.source),
          ],
        );
      }
      return json({ inserted: rows.length });
    }
  }

  const runShape = `r.id, s.slug as station_id, r.latitude, r.longitude, r.init_time, r.lead_hours, r.backend, r.status, r.created_at, r.cid`;
  if (area === "forecast-runs") {
    if (!a && method === "GET") {
      const status = url.searchParams.get("status");
      // The runner (token) sees every queued run; people see their own; staff see all.
      const rows = await sql.query<Record<string, unknown>>(
        `select ${runShape} from forecast_runs r left join stations s on s.id = r.station_id
         where ($1::text is null or r.status = $1)
           and ($2::bool or ($3::text is not null and r.requested_by = $3))
         order by ${status ? "r.created_at asc" : "r.created_at desc"} limit 50`,
        [status, trusted, viewer?.userId ?? null],
      );
      return json(rows);
    }
    if (!a && method === "POST") {
      if (!viewer) return fail(401, "Sign in to request a forecast run");
      const parsed = await body(
        request,
        z.object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          lead_hours: z.number().int().min(6).max(240).default(48),
          backend: z.enum(["local", "boinc", "cirrus"]).default("local"),
          station_id: z.string().max(80).optional(),
        }),
      );
      if (!parsed.ok) return parsed.res;
      const r = parsed.data;
      if (r.backend === "cirrus" && !CIRRUS_ENABLED()) return fail(409, "CIRRUS is not enabled on this server. Set CIRRUS_ENABLED=1 once the helm release is up.");
      if (r.backend === "boinc" && !BOINC_PROJECT_URL()) return fail(409, "No BOINC project configured. Set BOINC_PROJECT_URL in .env.");
      const open = await sql<{ n: number }>`select count(*) as n from forecast_runs where requested_by = ${viewer.userId} and status in ('queued', 'running')`;
      if (open[0].n >= 5 && !isStaff(viewer.role)) return fail(429, "You already have five runs waiting. Wait for one to finish.");
      let stationId: string | null = null;
      if (r.station_id) {
        const s = await stationBySlug(r.station_id, viewer);
        if (!s) return fail(404, "No such station");
        stationId = s.id;
      }
      const made = await sql.query<{ id: number }>(
        `insert into forecast_runs (station_id, requested_by, latitude, longitude, lead_hours, backend) values ($1, $2, $3, $4, $5, $6) returning id`,
        [stationId, viewer.userId, r.latitude, r.longitude, r.lead_hours, r.backend],
      );
      const row = await sql.query(`select ${runShape} from forecast_runs r left join stations s on s.id = r.station_id where r.id = $1`, [made[0].id]);
      return json(row[0]);
    }
    if (a && method === "PUT") {
      if (!trusted) return fail(401, "Runs are updated by the forecast service");
      const q = z
        .object({
          status: z.enum(["queued", "running", "done", "failed"]),
          detail: z.string().max(2000).default(""),
          cid: z.string().max(200).default(""),
          init_time: z.string().optional(),
        })
        .safeParse(Object.fromEntries(url.searchParams));
      if (!q.success) return fail(422, q.error.issues[0]?.message ?? "Invalid query");
      const id = Number(a);
      if (!Number.isInteger(id)) return fail(404, "No such run");
      const rows = await sql.query<{ id: number }>(
        `update forecast_runs set status = $2, detail = nullif($3, ''), cid = coalesce(nullif($4, ''), cid),
           init_time = coalesce($5::timestamptz, init_time), updated_at = now() where id = $1 returning id`,
        [id, q.data.status, q.data.detail, q.data.cid, q.data.init_time ?? null],
      );
      if (!rows[0]) return fail(404, "No such run");
      const row = await sql.query(`select ${runShape} from forecast_runs r left join stations s on s.id = r.station_id where r.id = $1`, [id]);
      return json(row[0]);
    }
  }

  if (area === "compute" && a === "status" && method === "GET") {
    const queued = await sql<{ backend: string; n: number }>`select backend, count(*) as n from forecast_runs where status in ('queued', 'running') group by backend`;
    const counts = Object.fromEntries(queued.map((r) => [r.backend, r.n]));
    const seen = await sql<{ t: string | null }>`select max(updated_at) as t from forecast_runs where backend = 'local' and status in ('done', 'running')`;
    const localAlive = Boolean(seen[0]?.t && Date.now() - new Date(seen[0].t).getTime() < 6 * 3600_000);
    const boinc = BOINC_PROJECT_URL();
    return json([
      { backend: "local", available: localAlive, queued: counts.local ?? 0, detail: localAlive ? "The forecast runner has reported recently." : "No run reported in the last six hours. Start the runner from infra/ with --profile forecast." },
      { backend: "boinc", available: Boolean(boinc), queued: counts.boinc ?? 0, detail: boinc ? `Project ${boinc}` : "No BOINC project configured yet." },
      { backend: "cirrus", available: CIRRUS_ENABLED(), queued: counts.cirrus ?? 0, detail: CIRRUS_ENABLED() ? "CIRRUS helm release accepts runs." : "Not enabled. See infra/helm." },
    ]);
  }
  if (area === "compute" && a === "boinc" && method === "GET") {
    return json({ project_url: BOINC_PROJECT_URL(), has_key: Boolean(process.env.BOINC_ACCOUNT_KEY) });
  }

  // ── place profile ──────────────────────────────────────────────────────────
  if (area === "place" && a === "ej" && !b && method === "GET") {
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    const buffer = Math.min(10, Math.max(0.1, Number(url.searchParams.get("buffer")) || 1));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return fail(422, "lat and lon are required");
    const now = Date.now();
    ejLimiter.at = ejLimiter.at.filter((t) => now - t < 60_000);
    if (ejLimiter.at.length >= 20 || ejLimiter.busy >= 3) return fail(429, "Too many place lookups right now. Try again in a minute.");
    ejLimiter.at.push(now);
    ejLimiter.busy += 1;
    try {
      const r = await fetch(`${EJAM_URL()}/data`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sites: [{ lat, lon }], buffer }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!r.ok) throw new Error(`EJAM answered ${r.status}`);
      const data = await r.json();
      return json(Array.isArray(data) && data.length ? data[0] : data);
    } catch (e) {
      return fail(502, `EJAM did not answer: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      ejLimiter.busy -= 1;
    }
  }
  if (area === "place" && a && a !== "svi" && a !== "ej" && method === "GET") {
    const s = await stationBySlug(decodeURIComponent(a), viewer);
    if (!s) return fail(404, "No such station");
    const rows = await sql<{ svi: unknown; ej: unknown; fetched_at: string }>`select svi, ej, fetched_at from place_profiles where station_id = ${s.id}`;
    return json({ station_id: s.slug, latitude: s.latitude, longitude: s.longitude, ...(rows[0] ?? { svi: null, ej: null, fetched_at: null }) });
  }
  if (area === "place" && (a === "svi" || a === "ej") && method === "PUT") {
    if (!trusted) return fail(401, "Place profiles are stored by the place loader");
    const slug = a === "ej" ? b : undefined;
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const stationSlug = a === "ej" ? slug : typeof raw?.station_id === "string" ? raw.station_id : undefined;
    if (!raw || !stationSlug) return fail(422, "A station is required");
    const found = await sql<{ id: string }>`select id from stations where slug = ${stationSlug}`;
    if (!found[0]) return fail(404, "No such station");
    const col = a === "svi" ? "svi" : "ej";
    await sql.query(
      `insert into place_profiles (station_id, ${col}) values ($1, $2::jsonb)
       on conflict (station_id) do update set ${col} = excluded.${col}, fetched_at = now()`,
      [found[0].id, JSON.stringify(raw)],
    );
    return json({ station_id: stationSlug });
  }

  // ── build collective ──────────────────────────────────────────────────────
  if (area === "collective" && a === "members") {
    if (method === "GET") {
      const rows = await sql<{ id: number; name: string; contact: string; area: string; offers: string[]; printers: string; notes: string; created_at: string }>`
        select id, name, contact, area, offers, printers, notes, created_at from collective_members order by created_at desc limit 200`;
      // Contact details stay with the steward: only staff see them.
      return json(viewer && isStaff(viewer.role) ? rows : rows.map((r) => ({ ...r, contact: "" })));
    }
    if (method === "POST") {
      if (!viewer) return fail(401, "Sign in to post an offer");
      const parsed = await body(
        request,
        z.object({
          name: z.string().trim().min(1).max(80),
          contact: z.string().max(200).default(""),
          area: z.string().max(80).default(""),
          offers: z.array(z.string().max(40)).max(10).default([]),
          printers: z.string().max(200).default(""),
          notes: z.string().max(500).default(""),
        }),
      );
      if (!parsed.ok) return parsed.res;
      const m = parsed.data;
      const row = await sql.query(
        `insert into collective_members (owner_id, name, contact, area, offers, printers, notes) values ($1, $2, $3, $4, $5::text[], $6, $7)
         returning id, name, contact, area, offers, printers, notes, created_at`,
        [viewer.userId, m.name, m.contact, m.area, m.offers, m.printers, m.notes],
      );
      return json(row[0]);
    }
  }
  if (area === "collective" && a === "inventory") {
    const read = () =>
      sql<{ id: number; station_label: string; part_id: string; status: string; owner: string; updated_at: string }>`
        select id, station_label, part_id, status, owner, updated_at from collective_inventory order by station_label, part_id limit 2000`;
    if (method === "GET") return json(await read());
    if (method === "PUT") {
      if (!viewer) return fail(401, "Sign in to save your print queue");
      const parsed = await body(
        request,
        z
          .array(
            z.object({
              station_label: z.string().trim().min(1).max(80),
              part_id: z.string().trim().min(1).max(40),
              status: z.enum(["queued", "printing", "done", "failed"]).default("queued"),
              owner: z.string().max(80).default(""),
            }),
          )
          .max(500),
      );
      if (!parsed.ok) return parsed.res;
      const items = parsed.data;
      if (items.length) {
        await sql.query(
          `insert into collective_inventory (owner_id, station_label, part_id, status, owner, updated_at)
           select $1, * , now() from unnest($2::text[], $3::text[], $4::text[], $5::text[])
           on conflict (owner_id, station_label, part_id) do update set status = excluded.status, owner = excluded.owner, updated_at = now()`,
          [viewer.userId, items.map((i) => i.station_label), items.map((i) => i.part_id), items.map((i) => i.status), items.map((i) => i.owner)],
        );
      }
      return json(await read());
    }
  }

  // ── consent and publications ─────────────────────────────────────────────
  if (area === "consent") {
    if (method === "GET") {
      if (!viewer) return json([]);
      const rows = await sql.query(
        `select distinct on (station_id) station_id, steward, contact, scope, gdex, license, recorded_at from data_consent
         where $1::bool or owner_id = $2 order by station_id, recorded_at desc`,
        [isStaff(viewer.role), viewer.userId],
      );
      return json(rows);
    }
    if (method === "POST") {
      if (!viewer) return fail(401, "Sign in to record a decision");
      const parsed = await body(
        request,
        z.object({
          station_id: z.string().trim().min(1).max(80),
          steward: z.string().trim().min(1).max(120),
          contact: z.string().max(200).default(""),
          scope: z.enum(["local", "community", "open"]).default("local"),
          gdex: z.boolean().default(false),
          license: z.string().max(60).default("CC BY 4.0"),
        }),
      );
      if (!parsed.ok) return parsed.res;
      const c = parsed.data;
      const row = await sql.query(
        `insert into data_consent (owner_id, station_id, steward, contact, scope, gdex, license) values ($1, $2, $3, $4, $5, $6, $7)
         returning station_id, steward, contact, scope, gdex, license, recorded_at`,
        [viewer.userId, c.station_id, c.steward, c.contact, c.scope, c.gdex, c.license],
      );
      return json(row[0]);
    }
  }
  if (area === "publications" && method === "GET") {
    return json(await sql`select id, station_id, period, status, cid, detail, created_at from gdex_publications order by created_at desc limit 100`);
  }

  return fail(404, "Not found");
}
