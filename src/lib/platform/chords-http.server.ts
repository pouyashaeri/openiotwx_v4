/** Request handlers for the CHORDS-compatible URLs. Kept out of the route files so they stay thin. */
import { getSessionUser } from "@/lib/auth/verify.server";
import { toChordsJson, toGeoCsv, type Flat } from "./chords-format.ts";
import { exportRows, publicInstruments, readableByChordsId, variableInfo } from "./chords.server";
import { checkKey, ingest, IngestError } from "./ingest.server";
import { fromChordsQuery } from "./parse.ts";
import { ensureProfile } from "./service.server";

const text = (body: string, status = 200, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": type, ...extra } });

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: extra });

/** GET/POST /measurements/url_create?instrument_id=1&t1=22.5&rh1=40[&at=…&api_key=…&test] */
export async function urlCreate(request: Request): Promise<Response> {
  const q = fromChordsQuery(new URL(request.url).searchParams);
  const header = request.headers.get("x-api-key");
  const key = q.key ?? header;
  try {
    if (q.test) {
      await checkKey(key, q.instrumentId);
      return text("Test measurement validated. Nothing was stored.");
    }
    await ingest(key, q.body, { instrumentId: q.instrumentId });
    return text("Measurement SAVED");
  } catch (err) {
    if (err instanceof IngestError) {
      return text(err.message, err.status, "text/plain; charset=utf-8", err.retryAfter ? { "retry-after": String(err.retryAfter) } : {});
    }
    console.error("[url_create]", err);
    return text("Internal error", 500);
  }
}

export async function listInstruments(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const rows = await publicInstruments();
  return json(
    rows.map((r) => ({
      id: r.chords_id,
      sensor_id: r.slug,
      name: r.name,
      site_id: r.chords_id,
      url: `${origin}/instruments/${r.chords_id}.json`,
    })),
  );
}

export async function listSites(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const rows = await publicInstruments();
  return json(
    rows.map((r) => ({
      id: r.chords_id,
      name: r.name,
      lat: r.latitude == null ? null : String(r.latitude),
      lon: r.longitude == null ? null : String(r.longitude),
      url: `${origin}/sites/${r.chords_id}.json`,
    })),
  );
}

export async function listVars(request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const rows = await publicInstruments();
  const info = await variableInfo([...new Set(rows.flatMap((r) => r.expected_metrics))]);
  const byShort = new Map(info.map((v) => [v.shortname, v]));
  let id = 0;
  return json(
    rows.flatMap((r) =>
      r.expected_metrics.map((m) => ({
        id: (id += 1),
        name: byShort.get(m)?.name ?? m,
        shortname: m,
        instrument_id: r.chords_id,
        url: `${origin}/vars/${id}.json`,
      })),
    ),
  );
}

/**
 * GET /instruments/<id>.<csv|json|geojson>?start=…&end=…&email=…&api_key=…
 * and the same under /api/v1/data/. Public stations need no key. Private ones
 * need a signed-in owner/admin, or the station's own key as `api_key`.
 */
export async function instrumentData(request: Request, file: string): Promise<Response> {
  const m = /^(\d+)\.(csv|json|geojson)$/i.exec(file);
  if (!m) return json({ errors: ["Use /<instrument id>.csv, .json or .geojson"] }, 404);
  const format = m[2].toLowerCase();
  const url = new URL(request.url);
  const apiKey = url.searchParams.get("api_key") ?? request.headers.get("x-api-key");

  const user = await getSessionUser().catch(() => null);
  const profile = user ? await ensureProfile(user.id).catch(() => null) : null;
  const station = await readableByChordsId(
    Number(m[1]),
    profile && !profile.suspended ? { userId: profile.userId, role: profile.role } : null,
    apiKey,
  );
  if (!station) return json({ errors: ["Access Denied, user authentication required."] }, 403);

  const now = Date.now();
  const startOfDay = new Date(now).setUTCHours(0, 0, 0, 0);
  const parse = (v: string | null, fallback: number) => {
    if (!v) return fallback;
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
    return Number.isFinite(t) ? t : fallback;
  };
  const from = parse(url.searchParams.get("start"), startOfDay);
  const to = parse(url.searchParams.get("end"), now);
  if (to - from > 366 * 86_400_000) return json({ errors: ["Ask for at most one year at a time"] }, 400);

  const rows: Flat[] = await exportRows(station.id, new Date(from), new Date(to));
  const shorts = [...new Set(rows.map((r) => r.metric))];
  const info = await variableInfo(shorts);
  const units = Object.fromEntries(info.map((v) => [v.shortname, v.units]));

  if (format === "csv") {
    return text(
      toGeoCsv({ name: station.name, latitude: station.latitude, longitude: station.longitude, units }, rows),
      200,
      "text/csv; charset=utf-8",
      { "content-disposition": `attachment; filename="${station.slug}.csv"` },
    );
  }
  const doc = toChordsJson(
    { id: station.chords_id, name: station.name, slug: station.slug, latitude: station.latitude, longitude: station.longitude },
    info,
    rows,
  );
  if (format === "geojson") {
    return json(
      {
        type: "FeatureCollection",
        features: doc.data.map((d) => ({
          type: "Feature",
          geometry: station.longitude != null && station.latitude != null ? { type: "Point", coordinates: [station.longitude, station.latitude] } : null,
          properties: { time: d.time, ...d.measurements },
        })),
      },
      200,
      { "content-disposition": `attachment; filename="${station.slug}.geojson"` },
    );
  }
  return json(doc, 200, { "content-disposition": `inline; filename="${station.slug}.json"` });
}
