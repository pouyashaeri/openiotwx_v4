import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminMiddleware, appUserMiddleware } from "./middleware";
import type { Range } from "./metrics";

const id = z.string().uuid();
const range = z.enum(["6h", "24h", "7d", "30d", "1y"]);
const actor = (c: { profile: { userId: string; role: "user" | "admin" | "superadmin" } }) => ({
  userId: c.profile.userId,
  role: c.profile.role,
});

// ── me ───────────────────────────────────────────────────────────────────────

export const getMe = createServerFn({ method: "GET" })
  .middleware([appUserMiddleware])
  .handler(async ({ context }) => context.profile);

// ── plans ────────────────────────────────────────────────────────────────────

export const listPlans = createServerFn({ method: "GET" })
  .middleware([appUserMiddleware])
  .handler(async ({ context }) => (await import("./service.server")).listPlans(context.profile.userId));

export const loadPlan = createServerFn({ method: "GET" })
  .middleware([appUserMiddleware])
  .validator(z.object({ id }))
  .handler(async ({ context, data }) => (await import("./service.server")).getPlan(context.profile.userId, data.id));

export const savePlan = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(
    z.object({
      id: id.optional(),
      name: z.string().trim().min(1).max(120),
      configId: z.string().max(8).nullable(),
      stationCount: z.number().int().min(1).max(1000),
      data: z.record(z.string(), z.unknown()),
    }),
  )
  .handler(async ({ context, data }) => (await import("./service.server")).savePlan(context.profile.userId, data));

export const removePlan = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(z.object({ id }))
  .handler(async ({ context, data }) => {
    await (await import("./service.server")).deletePlan(context.profile.userId, data.id);
  });

// ── stations ─────────────────────────────────────────────────────────────────

export const listMyStations = createServerFn({ method: "GET" })
  .middleware([appUserMiddleware])
  .handler(async ({ context }) => (await import("./service.server")).listStations(context.profile.userId));

const newStation = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  planId: id.nullable().optional(),
  configId: z.string().max(8).nullable().optional(),
  link: z.string().max(16).nullable().optional(),
  expectedMetrics: z.array(z.string().max(40)).max(64).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  ncarNetwork: z.boolean().optional(),
});

/** Returns each new station with its API key. The key is only ever shown here. */
export const createStations = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(z.object({ stations: z.array(newStation).min(1).max(50) }))
  .handler(async ({ context, data }) =>
    (await import("./service.server")).createStations(context.profile.userId, data.stations),
  );

export const editStation = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(
    z.object({
      id,
      name: z.string().trim().min(1).max(80).optional(),
      description: z.string().max(500).optional(),
      isPublic: z.boolean().optional(),
      ncarNetwork: z.boolean().optional(),
      gatewayId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_.:-]{0,64}$/, "Letters, numbers and . _ : - only")
        .nullable()
        .optional(),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { id: stationId, ...patch } = data;
    // Owners never get to touch status / limits / ownership here, even if sent.
    try {
      await (await import("./service.server")).updateStation(actor(context), stationId, patch);
    } catch (e) {
      if (e instanceof Error && /stations_gateway_uq/.test(e.message)) throw new Error("Another station already uses that gateway id");
      throw e;
    }
  });

export const newKey = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(z.object({ id }))
  .handler(async ({ context, data }) => (await import("./service.server")).rotateKey(actor(context), data.id));

export const removeStation = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(z.object({ id }))
  .handler(async ({ context, data }) => {
    await (await import("./service.server")).deleteStation(actor(context), data.id);
  });

// ── station pages ────────────────────────────────────────────────────────────
// Public stations are readable signed-out, so these resolve the viewer softly.

async function softViewer() {
  const { getSessionUser } = await import("@/lib/auth/verify.server");
  const user = await getSessionUser().catch(() => null);
  if (!user) return null;
  const { ensureProfile } = await import("./service.server");
  const p = await ensureProfile(user.id).catch(() => null);
  return p && !p.suspended ? { userId: p.userId, role: p.role } : null;
}

export const publicStations = createServerFn({ method: "GET" }).handler(async () =>
  (await import("./service.server")).listPublicStations(),
);

export const stationView = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().min(1).max(80), range: range.optional(), metric: z.string().max(40).optional() }))
  .handler(async ({ data }) => {
    const svc = await import("./service.server");
    const viewer = await softViewer();
    const station = await svc.getStationFor(data.slug, viewer);
    if (!station) return null;
    const metrics = Object.keys(station.last_values);
    const metric = data.metric && metrics.includes(data.metric) ? data.metric : (metrics[0] ?? station.expected_metrics[0]);
    const r: Range = data.range ?? "24h";
    const series = metric ? await svc.stationSeries(station.id, metric, r) : [];
    const canEdit = Boolean(viewer && (viewer.role !== "user" || viewer.userId === station.owner_id));
    return { station, metric: metric ?? null, series, canEdit };
  });

// ── admin ────────────────────────────────────────────────────────────────────

export const adminOverview = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () => (await import("./service.server")).adminOverview());

export const adminStations = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      q: z.string().max(80).default(""),
      status: z.enum(["", "active", "disabled"]).default(""),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ data }) => (await import("./service.server")).adminStations(data.q, data.status, 50, data.offset));

export const adminEditStation = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      id,
      status: z.enum(["active", "disabled"]).optional(),
      rateLimitPerMin: z.number().int().min(1).max(100000).optional(),
      ownerId: z.string().max(100).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { id: stationId, ...patch } = data;
    await (await import("./service.server")).updateStation(actor(context), stationId, patch);
  });

export const adminUsers = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () => (await import("./service.server")).adminUsers());

export const adminUserDetail = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .validator(z.object({ userId: z.string().max(100) }))
  .handler(async ({ data }) => (await import("./service.server")).adminUserDetail(data.userId));

/** Suspend, restore, promote/demote (super-admin), sign out everywhere, reset password, delete. */
export const adminUserAction = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      userId: z.string().max(100),
      action: z.enum(["suspend", "restore", "make_admin", "remove_admin", "revoke_sessions", "reset_password", "delete"]),
    }),
  )
  .handler(async ({ context, data }) =>
    (await import("./service.server")).adminUserAction(actor(context), data.userId, data.action),
  );

// ── variables / parameters ───────────────────────────────────────────────────

export const listVariables = createServerFn({ method: "GET" })
  .middleware([appUserMiddleware])
  .handler(async () => (await import("./chords.server")).listVariables());

export const addVariable = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(
    z.object({
      shortname: z.string().trim().toLowerCase().min(1).max(40),
      name: z.string().trim().min(1).max(80),
      units: z.string().trim().max(20).default(""),
      category: z.string().trim().max(30).default("other"),
    }),
  )
  .handler(async ({ context, data }) => {
    await (await import("./chords.server")).addVariable(context.profile.userId, data);
  });

export const removeVariable = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(z.object({ shortname: z.string().max(40) }))
  .handler(async ({ context, data }) => {
    await (await import("./chords.server")).deleteVariable(actor(context), data.shortname);
  });

/** Which variables a station reports, and whether to reject uploads outside that list. */
export const setStationParams = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(z.object({ id, metrics: z.array(z.string().max(40)).max(64), strict: z.boolean() }))
  .handler(async ({ context, data }) => {
    await (await import("./chords.server")).setStationParams(actor(context), data.id, data);
  });

// ── CHORDS import ────────────────────────────────────────────────────────────

export const chordsBrowse = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(z.object({ portal: z.string().trim().min(3).max(300) }))
  .handler(async ({ data }) => (await import("./chords-remote.server")).browsePortal(data.portal));

export const chordsImport = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(
    z.object({
      portal: z.string().trim().min(3).max(300),
      instrumentId: z.number().int().positive(),
      name: z.string().trim().min(1).max(80),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
      email: z.string().trim().max(200).optional(),
      apiKey: z.string().trim().max(200).optional(),
      everyMin: z.number().int().min(5).max(1440).optional(),
      isPublic: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const r = await (await import("./chords.server")).importFromChords(context.profile.userId, data);
    return { slug: r.station.slug, rows: r.rows, warning: r.warning };
  });

export const chordsSyncNow = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(z.object({ id }))
  .handler(async ({ context, data }) => (await import("./chords.server")).syncNow(actor(context), data.id));

// ── network map + database console ──────────────────────────────────────────

export const mapData = createServerFn({ method: "GET" }).handler(async () => {
  const viewer = await softViewer();
  return (await import("./service.server")).mapStations(viewer);
});

/** Instruments on a CHORDS portal, for the map. Signed-out visitors may only read the listed public portals. */
export const chordsMap = createServerFn({ method: "GET" })
  .validator(z.object({ portal: z.string().trim().min(3).max(300) }))
  .handler(async ({ data }) => {
    const remote = await import("./chords-remote.server");
    const { PORTALS } = await import("./chords-portals");
    const portal = remote.normalizePortal(data.portal);
    if (!(await softViewer()) && !PORTALS.some((p) => remote.normalizePortal(p.url) === portal)) {
      throw new Error("Sign in to look at other portals");
    }
    return remote.mapPortal(portal);
  });

export const adminDatabase = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () => (await import("./service.server")).adminDatabase());

export const adminTableRows = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .validator(z.object({ table: z.string().max(40), offset: z.number().int().min(0).default(0) }))
  .handler(async ({ data }) => (await import("./service.server")).adminTableRows(data.table, 50, data.offset));
