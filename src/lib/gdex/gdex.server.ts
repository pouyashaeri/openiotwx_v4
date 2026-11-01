/**
 * GDEX data access and release management (server-only).
 *
 * The flow: a station's steward gives consent -> on a monthly or quarterly cadence an admin (or the
 * scheduler) builds a DRAFT release -> an admin reads the quality report and marks it READY -> GDEX pulls it
 * from the public manifest -> the admin records the GDEX submission reference (SUBMITTED) and the DOI GDEX
 * assigns (PUBLISHED). Nothing ever goes out on its own: drafts are private, and only a person promotes one.
 */
import { getSql } from "@/lib/db";
import { audit, type Role } from "@/lib/platform/service.server";
import { cfFor } from "./cf";
import { lastCompletePeriod, parsePeriod, recentPeriods, type Cadence, type Period } from "./period";
import { buildRelease, type BuiltRelease, type DatasetInfo, type Issue, type Observation, type StationInfo, type StationSummary, type VariableSummary } from "./release";

export const LICENSES = ["CC BY 4.0", "CC0 1.0", "ODbL 1.0"] as const;
export const SUBMIT_URL = "https://gdex.ucar.edu/resources/submit-data/";

export type Settings = Omit<DatasetInfo, "updateFrequency" | "softwareVersion"> & {
  cadence: Cadence;
  /** The scheduler builds a draft each time a period ends. It never marks anything ready. */
  autoDraft: boolean;
};

function defaults(): Settings {
  const email = (process.env.GDEX_CONTACT_EMAIL ?? "").trim();
  return {
    slug: "openiotwx-network",
    title: "OpenIoTwx community weather and environment station network",
    summary:
      "Near-surface weather and environment observations (air temperature, humidity, pressure, wind, rain, particulate matter and related variables) " +
      "from community-built OpenIoTwx stations that joined the NCAR research network. Each station's steward consented to publication. " +
      "Observations are reported at the stations' own reporting interval and released monthly or quarterly as CF-compliant NetCDF with CSV copies.",
    institution: "NSF National Center for Atmospheric Research (NCAR), OpenIoTwx community project",
    creatorName: "OpenIoTwx community",
    creatorEmail: email,
    creatorUrl: "https://ncar.github.io/openiotwx/",
    contactName: "OpenIoTwx data steward",
    contactEmail: email,
    license: "CC BY 4.0",
    keywords: ["weather", "community science", "low-cost sensors", "internet of things", "air quality", "NCAR research network"],
    namingAuthority: "openiotwx",
    references: "https://ncar.github.io/openiotwx/",
    acknowledgement: "Data come from community stewards who built and run their own stations.",
    coordinateDecimals: 3,
    cadence: "monthly",
    autoDraft: true,
  };
}

export async function getSettings(): Promise<Settings> {
  const sql = await getSql();
  const rows = await sql<{ value: Partial<Settings> }>`select value from gdex_settings where key = 'dataset'`;
  const stored = rows[0]?.value ?? {};
  const base = defaults();
  const merged = { ...base, ...stored };
  // Blank stored contact fields fall back to the environment, so setting GDEX_CONTACT_EMAIL later still works.
  for (const k of ["creatorEmail", "contactEmail"] as const) if (!String(merged[k] ?? "").trim()) merged[k] = base[k];
  return merged;
}

export async function saveSettings(actorId: string, patch: Partial<Settings>): Promise<Settings> {
  const sql = await getSql();
  const next = { ...(await getSettings()), ...patch };
  await sql.query(
    `insert into gdex_settings (key, value, updated_at) values ('dataset', $1::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  await audit(actorId, "gdex.settings", null, { fields: Object.keys(patch) });
  return next;
}

function datasetInfo(s: Settings): DatasetInfo {
  const { cadence, autoDraft: _a, ...rest } = s;
  return { ...rest, updateFrequency: cadence, softwareVersion: process.env.APP_VERSION?.trim() || "v4" };
}

// ── Stations and consent ────────────────────────────────────────────────────

type EligibleRow = {
  id: string;
  slug: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevation_m: number | null;
  gdex_steward: string;
  gdex_license: string;
};

/** Stations that may be packaged: device stations in the NCAR network whose steward consented. */
export async function eligibleStations(): Promise<(StationInfo & { stationId: string })[]> {
  const sql = await getSql();
  const rows = await sql.query<EligibleRow>(
    `select id, slug, name, latitude, longitude, elevation_m, gdex_steward, gdex_license from stations
     where ncar_network and gdex_consent and source = 'device' and status = 'active' and gdex_steward <> ''
     order by slug`,
  );
  return rows.map((r) => ({
    stationId: r.id,
    id: r.slug,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    elevation: r.elevation_m,
    steward: r.gdex_steward,
    license: r.gdex_license,
  }));
}

export type Readiness = {
  /** Can this station's data be packaged for GDEX right now? */
  ready: boolean;
  checks: { id: string; ok: boolean; label: string; hint: string }[];
  variables: { name: string; label: string; standardName: string | null; units: string; mapped: boolean }[];
  readings30d: number;
};

/** What stands between a station and GDEX, in plain words, for the station page and the deploy step. */
export async function stationReadiness(stationId: string): Promise<(Readiness & { consent: { granted: boolean; steward: string; license: string; at: string | null } }) | null> {
  const sql = await getSql();
  const [s] = await sql.query<{
    source: string;
    ncar_network: boolean;
    latitude: number | null;
    longitude: number | null;
    elevation_m: number | null;
    gdex_consent: boolean;
    gdex_steward: string;
    gdex_license: string;
    gdex_consent_at: string | null;
    status: string;
  }>(
    "select source, ncar_network, latitude, longitude, elevation_m, gdex_consent, gdex_steward, gdex_license, gdex_consent_at, status from stations where id = $1",
    [stationId],
  );
  if (!s) return null;
  const [{ n, metrics }] = await sql.query<{ n: string; metrics: string[] | null }>(
    `select count(*)::text as n, array_agg(distinct metric) as metrics from measurements
     where station_id = $1 and time > now() - interval '30 days'`,
    [stationId],
  );
  const names = (metrics ?? []).sort();
  const variables = names.map((m) => {
    const c = cfFor(m);
    return { name: m, label: c.longName, standardName: c.standardName ?? null, units: c.units, mapped: c.mapped };
  });
  const checks = [
    { id: "device", ok: s.source === "device", label: "Your own station", hint: "Stations imported from a CHORDS portal belong to that portal's owner and are never packaged." },
    { id: "network", ok: s.ncar_network, label: "In the NCAR research network", hint: "Join the network first. GDEX only takes data that is shared openly." },
    { id: "location", ok: s.latitude !== null && s.longitude !== null, label: "Has a location", hint: "GDEX needs coordinates on every station." },
    { id: "elevation", ok: s.elevation_m !== null, label: "Has an elevation", hint: "Optional but helpful: altitude is written as missing without it." },
    { id: "steward", ok: s.gdex_steward.trim() !== "", label: "A named steward", hint: "Consent needs a person, not a device." },
    { id: "consent", ok: s.gdex_consent, label: "Consent to publish in GDEX", hint: "Turn it on below. You can withdraw any time; releases already made stay." },
    { id: "data", ok: Number(n) > 0, label: "Readings in the last 30 days", hint: "Nothing can be packaged until the station has reported." },
    { id: "mapped", ok: variables.length > 0 && variables.every((v) => v.mapped), label: "Every variable has units", hint: "Unknown measurement names are exported with units \"1\" and a warning." },
  ];
  const required = ["device", "network", "location", "steward", "consent", "data"];
  return {
    ready: required.every((id) => checks.find((c) => c.id === id)?.ok) && s.status === "active",
    checks,
    variables,
    readings30d: Number(n),
    consent: { granted: s.gdex_consent, steward: s.gdex_steward, license: s.gdex_license, at: s.gdex_consent_at },
  };
}

/** The owner (or an admin) grants or withdraws consent. Both are logged. */
export async function setConsent(
  actor: { userId: string; role: Role },
  stationId: string,
  input: { consent: boolean; steward: string; license: string },
) {
  const sql = await getSql();
  const admin = actor.role !== "user";
  const [s] = await sql.query<{ owner_id: string; source: string; ncar_network: boolean; latitude: number | null; gdex_steward: string; gdex_license: string }>(
    "select owner_id, source, ncar_network, latitude, gdex_steward, gdex_license from stations where id = $1",
    [stationId],
  );
  if (!s || (!admin && s.owner_id !== actor.userId)) throw new Error("Station not found");
  if (input.consent) {
    if (s.source !== "device") throw new Error("Imported CHORDS stations stay private. Their data belongs to the portal that publishes it");
    if (!s.ncar_network) throw new Error("Join the NCAR research network first. GDEX only takes data that is shared openly");
    if (s.latitude === null) throw new Error("Set the station's location first. GDEX needs coordinates");
    if (!input.steward.trim()) throw new Error("Name the steward. Consent needs a person, not a device");
    if (!LICENSES.includes(input.license as (typeof LICENSES)[number])) throw new Error("Choose one of the offered licenses");
  }
  const steward = input.consent ? input.steward.trim().slice(0, 120) : s.gdex_steward;
  const license = input.consent ? input.license : s.gdex_license;
  await sql.query(
    `update stations set gdex_consent = $2, gdex_steward = $3, gdex_license = $4,
       gdex_consent_at = case when $2::bool then now() else gdex_consent_at end where id = $1`,
    [stationId, input.consent, steward, license],
  );
  await sql.query("insert into gdex_consent_log (station_id, action, steward, license, actor_id) values ($1, $2, $3, $4, $5)", [
    stationId,
    input.consent ? "grant" : "revoke",
    steward,
    license,
    actor.userId,
  ]);
  await audit(actor.userId, input.consent ? "gdex.consent.grant" : "gdex.consent.revoke", stationId, { steward, license });
}

// ── Releases ────────────────────────────────────────────────────────────────

type ReleaseRow = {
  id: string;
  period: string;
  kind: "month" | "quarter";
  period_start: string;
  period_end: string;
  status: "draft" | "ready" | "submitted" | "published";
  station_count: number;
  observation_count: string;
  variables: VariableSummary[];
  stations: StationSummary[];
  issues: Issue[];
  error_count: number;
  warning_count: number;
  first_time: string | null;
  last_time: string | null;
  built_by: string | null;
  built_at: string;
  submission_ref: string;
  doi: string;
  notes: string;
  status_changed_at: string;
};

const RELEASE_COLS = `id, period, kind, period_start, period_end, status, station_count, observation_count::text as observation_count,
  variables, stations, issues, error_count, warning_count, first_time, last_time, built_by, built_at, submission_ref, doi, notes, status_changed_at`;

export type ReleaseFileInfo = { name: string; contentType: string; size: number; sha256: string };
export type Release = Omit<ReleaseRow, "observation_count"> & { observation_count: number; files: ReleaseFileInfo[] };

async function filesOf(ids: string[]): Promise<Map<string, ReleaseFileInfo[]>> {
  const out = new Map<string, ReleaseFileInfo[]>();
  if (ids.length === 0) return out;
  const sql = await getSql();
  const rows = await sql.query<{ release_id: string; name: string; content_type: string; size_bytes: string; sha256: string }>(
    "select release_id, name, content_type, size_bytes::text as size_bytes, sha256 from gdex_release_files where release_id = any($1::uuid[]) order by name",
    [ids],
  );
  for (const r of rows) out.set(r.release_id, [...(out.get(r.release_id) ?? []), { name: r.name, contentType: r.content_type, size: Number(r.size_bytes), sha256: r.sha256 }]);
  // The NetCDF first (it is what GDEX wants), then the CSV, the metadata, and the checksums last.
  const rank = (n: string) => (n.endsWith(".nc") ? 0 : n.endsWith(".csv") ? 1 : n.endsWith(".json") ? 2 : 3);
  for (const [id, list] of out) out.set(id, [...list].sort((x, y) => rank(x.name) - rank(y.name) || x.name.localeCompare(y.name)));
  return out;
}

export async function listReleases(): Promise<Release[]> {
  const sql = await getSql();
  const rows = await sql.query<ReleaseRow>(`select ${RELEASE_COLS} from gdex_releases order by period_start desc`);
  const files = await filesOf(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, observation_count: Number(r.observation_count), files: files.get(r.id) ?? [] }));
}

export async function getRelease(period: string): Promise<Release | null> {
  return (await listReleases()).find((r) => r.period === period) ?? null;
}

/** Releases GDEX may fetch: the ones an admin has marked ready or beyond. Drafts are private. */
export const isPublicStatus = (s: Release["status"]) => s !== "draft";

const fromHex = (hex: string) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function releaseFile(period: string, name: string): Promise<{ status: Release["status"]; contentType: string; data: Uint8Array; sha256: string } | null> {
  const sql = await getSql();
  const rows = await sql.query<{ status: Release["status"]; content_type: string; sha256: string; hex: string }>(
    `select r.status, f.content_type, f.sha256, encode(f.data, 'hex') as hex
     from gdex_releases r join gdex_release_files f on f.release_id = r.id where r.period = $1 and f.name = $2`,
    [period, name],
  );
  const r = rows[0];
  return r ? { status: r.status, contentType: r.content_type, data: fromHex(r.hex), sha256: r.sha256 } : null;
}

/** Read one station's readings for a period as rows of (time, values), one per instant. */
async function observations(stationId: string, period: Period): Promise<Observation[]> {
  const sql = await getSql();
  const rows = await sql.query<{ t: number; metric: string; value: number }>(
    `select extract(epoch from time)::float8 as t, metric, value from measurements
     where station_id = $1 and time >= $2 and time < $3 order by time, metric`,
    [stationId, period.start.toISOString(), period.end.toISOString()],
  );
  const out: Observation[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.t === r.t) last.values[r.metric] = r.value;
    else out.push({ t: r.t, values: { [r.metric]: r.value } });
  }
  return out;
}

/** Everything a release would contain, built in memory. Nothing is stored. */
export async function previewRelease(periodId: string): Promise<BuiltRelease> {
  const period = parsePeriod(periodId);
  if (!period) throw new Error("Unknown period. Use 2026-10 or 2026-Q4");
  const settings = await getSettings();
  const stations = await eligibleStations();
  const withRows = [];
  for (const s of stations) withRows.push({ info: s, rows: await observations(s.stationId, period) });
  return buildRelease({ period, dataset: datasetInfo(settings), stations: withRows });
}

export type BuildResult = { ok: boolean; release: Release | null; issues: Issue[]; stations: number; rows: number };

/** Build a release and store it as a draft. A period that was already moved past "draft" cannot be rebuilt. */
export async function buildAndStore(actorId: string | null, periodId: string): Promise<BuildResult> {
  const period = parsePeriod(periodId);
  if (!period) throw new Error("Unknown period. Use 2026-10 or 2026-Q4");
  // Testing aid: ingest only accepts readings from the last 30 days, so a test cannot fill a finished month.
  const allowOpen = process.env.GDEX_ALLOW_OPEN_PERIOD === "1";
  if (period.end.getTime() > Date.now() && !allowOpen) throw new Error(`${period.label} has not ended yet. Releases cover finished periods only`);
  const existing = await getRelease(period.id);
  if (existing && existing.status !== "draft") throw new Error(`${period.label} is already ${existing.status}. Only a draft can be rebuilt`);
  const built = await previewRelease(period.id);
  if (!built.ok || built.files.length === 0) return { ok: false, release: existing, issues: built.issues, stations: built.stations.length, rows: built.rows };

  const sql = await getSql();
  const errors = built.issues.filter((i) => i.severity === "error").length;
  const warnings = built.issues.filter((i) => i.severity === "warning").length;
  const [row] = await sql.query<{ id: string }>(
    `insert into gdex_releases (period, kind, period_start, period_end, status, station_count, observation_count, variables, stations, issues,
        error_count, warning_count, first_time, last_time, built_by, built_at, status_changed_at)
     values ($1, $2, $3, $4, 'draft', $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, now(), now())
     on conflict (period) do update set station_count = excluded.station_count, observation_count = excluded.observation_count,
        variables = excluded.variables, stations = excluded.stations, issues = excluded.issues, error_count = excluded.error_count,
        warning_count = excluded.warning_count, first_time = excluded.first_time, last_time = excluded.last_time,
        built_by = excluded.built_by, built_at = now(), status_changed_at = now()
     returning id`,
    [
      period.id,
      period.kind,
      period.start.toISOString(),
      period.end.toISOString(),
      built.stations.length,
      built.rows,
      JSON.stringify(built.variables),
      JSON.stringify(built.stations),
      JSON.stringify(built.issues),
      errors,
      warnings,
      built.firstTime,
      built.lastTime,
      actorId,
    ],
  );
  await sql.query("delete from gdex_release_files where release_id = $1", [row.id]);
  for (const f of built.files) {
    await sql.query(
      "insert into gdex_release_files (release_id, name, content_type, size_bytes, sha256, data) values ($1, $2, $3, $4, $5, decode($6, 'hex'))",
      [row.id, f.name, f.contentType, f.data.length, f.sha256, toHex(f.data)],
    );
  }
  await audit(actorId, "gdex.release.build", period.id, { stations: built.stations.length, rows: built.rows, warnings });
  return { ok: true, release: await getRelease(period.id), issues: built.issues, stations: built.stations.length, rows: built.rows };
}

const NEXT: Record<Release["status"], Release["status"][]> = {
  draft: ["ready"],
  ready: ["draft", "submitted"],
  submitted: ["ready", "published"],
  published: [],
};

export async function setReleaseStatus(
  actorId: string,
  periodId: string,
  input: { status: Release["status"]; submissionRef?: string; doi?: string; notes?: string },
) {
  const r = await getRelease(periodId);
  if (!r) throw new Error("Release not found");
  if (input.status !== r.status && !NEXT[r.status].includes(input.status)) throw new Error(`A ${r.status} release cannot become ${input.status}`);
  if (input.status === "ready" && r.error_count > 0) throw new Error("This release has errors in its quality report. Fix them and rebuild first");
  if (input.status === "ready" && r.files.length === 0) throw new Error("This release has no files");
  if (input.status === "submitted" && !(input.submissionRef ?? r.submission_ref).trim()) throw new Error("Enter the GDEX submission reference first");
  if (input.status === "published" && !(input.doi ?? r.doi).trim()) throw new Error("Enter the DOI GDEX assigned first");
  const sql = await getSql();
  await sql.query(
    `update gdex_releases set status = $2, submission_ref = coalesce($3, submission_ref), doi = coalesce($4, doi), notes = coalesce($5, notes),
       status_changed_at = case when status <> $2 then now() else status_changed_at end where period = $1`,
    [periodId, input.status, input.submissionRef?.trim() ?? null, input.doi?.trim() ?? null, input.notes?.trim() ?? null],
  );
  await audit(actorId, "gdex.release.status", periodId, { from: r.status, to: input.status });
}

export async function deleteDraft(actorId: string, periodId: string) {
  const r = await getRelease(periodId);
  if (!r) throw new Error("Release not found");
  if (r.status !== "draft") throw new Error("Only a draft can be deleted. A release that GDEX may already hold is kept");
  const sql = await getSql();
  await sql.query("delete from gdex_releases where period = $1", [periodId]);
  await audit(actorId, "gdex.release.delete", periodId, {});
}

/** For the scheduler: build the draft for the period that just ended, once. */
export async function buildDue(now = new Date()): Promise<{ period: string; action: "built" | "exists" | "off" | "blocked"; detail: string }> {
  const settings = await getSettings();
  const period = lastCompletePeriod(settings.cadence, now);
  if (!settings.autoDraft) return { period: period.id, action: "off", detail: "Automatic drafts are switched off." };
  if (await getRelease(period.id)) return { period: period.id, action: "exists", detail: "A release for this period already exists." };
  const r = await buildAndStore(null, period.id);
  if (!r.ok) return { period: period.id, action: "blocked", detail: r.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ") || "Nothing to release." };
  return { period: period.id, action: "built", detail: `Draft built: ${r.stations} stations, ${r.rows} observations.` };
}

// ── Overview for the admin console and the public page ──────────────────────

export async function adminOverview() {
  const settings = await getSettings();
  const sql = await getSql();
  const [counts] = await sql.query<{ network: string; consented: string; eligible: string }>(
    `select count(*) filter (where ncar_network and source = 'device')::text as network,
            count(*) filter (where gdex_consent and source = 'device')::text as consented,
            count(*) filter (where ncar_network and gdex_consent and source = 'device' and status = 'active' and gdex_steward <> '')::text as eligible
     from stations`,
  );
  const stations = await sql.query<{ slug: string; name: string; gdex_steward: string; gdex_license: string; gdex_consent_at: string | null; ncar_network: boolean; gdex_consent: boolean; latitude: number | null }>(
    `select slug, name, gdex_steward, gdex_license, gdex_consent_at, ncar_network, gdex_consent, latitude from stations
     where gdex_consent and source = 'device' order by slug`,
  );
  const releases = await listReleases();
  const have = new Set(releases.map((r) => r.period));
  return {
    settings,
    counts: { network: Number(counts.network), consented: Number(counts.consented), eligible: Number(counts.eligible) },
    stations,
    releases,
    periods: recentPeriods(settings.cadence, 8).map((p) => ({ id: p.id, label: p.label, built: have.has(p.id) })),
    submitUrl: SUBMIT_URL,
  };
}

export async function publicSummary(origin: string) {
  const settings = await getSettings();
  const sql = await getSql();
  const [c] = await sql.query<{ network: string; eligible: string }>(
    `select count(*) filter (where ncar_network and source = 'device')::text as network,
            count(*) filter (where ncar_network and gdex_consent and source = 'device' and status = 'active' and gdex_steward <> '')::text as eligible
     from stations`,
  );
  const releases = (await listReleases()).filter((r) => isPublicStatus(r.status));
  const latest = releases[0];
  const variables = latest?.variables ?? [];
  return {
    dataset: { title: settings.title, summary: settings.summary, license: settings.license, cadence: settings.cadence, institution: settings.institution, keywords: settings.keywords },
    counts: { network: Number(c.network), eligible: Number(c.eligible) },
    releases: releases.map((r) => ({
      period: r.period,
      status: r.status,
      doi: r.doi,
      stations: r.station_count,
      observations: r.observation_count,
      first: r.first_time,
      last: r.last_time,
      files: r.files.map((f) => ({ ...f, url: `${origin}/gdex/releases/${r.period}/${encodeURIComponent(f.name)}` })),
    })),
    variables,
    manifestUrl: `${origin}/gdex/manifest.json`,
    submitUrl: SUBMIT_URL,
  };
}

/** The machine-readable list GDEX (or anyone) can poll. Files carry checksums, so a pull can be verified. */
export async function manifest(origin: string) {
  const settings = await getSettings();
  const releases = (await listReleases()).filter((r) => isPublicStatus(r.status));
  return {
    schema: "openiotwx-gdex-manifest/1",
    generated: new Date().toISOString(),
    dataset: {
      id: settings.slug,
      title: settings.title,
      summary: settings.summary,
      license: settings.license,
      institution: settings.institution,
      update_frequency: settings.cadence,
      contact: { name: settings.contactName, email: settings.contactEmail },
      keywords: settings.keywords,
      formats: ["NetCDF-3 classic (CF-1.8, ACDD-1.3)", "CSV", "JSON metadata"],
      time: "Numeric, seconds since 1970-01-01 00:00:00 UTC",
    },
    releases: releases.map((r) => ({
      period: r.period,
      status: r.status,
      doi: r.doi || null,
      start: r.period_start,
      end: r.period_end,
      stations: r.station_count,
      observations: r.observation_count,
      time_coverage: { start: r.first_time, end: r.last_time },
      quality: { errors: r.error_count, warnings: r.warning_count },
      files: r.files.map((f) => ({ name: f.name, url: `${origin}/gdex/releases/${r.period}/${encodeURIComponent(f.name)}`, size: f.size, sha256: f.sha256, content_type: f.contentType })),
    })),
  };
}
