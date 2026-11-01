import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminMiddleware, appUserMiddleware } from "@/lib/platform/middleware";

const stationId = z.string().uuid();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/, "Use 2026-10 or 2026-Q4");
const actor = (c: { profile: { userId: string; role: "user" | "admin" | "superadmin" } }) => ({ userId: c.profile.userId, role: c.profile.role });

/** The owner's view of one station: what is in the way of GDEX, and the recorded consent. */
export const gdexStationState = createServerFn({ method: "GET" })
  .middleware([appUserMiddleware])
  .validator(z.object({ id: stationId }))
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql.query<{ owner_id: string }>("select owner_id from stations where id = $1", [data.id]);
    if (!rows[0] || (rows[0].owner_id !== context.profile.userId && context.profile.role === "user")) throw new Error("Station not found");
    return (await import("./gdex.server")).stationReadiness(data.id);
  });

export const gdexSetConsent = createServerFn({ method: "POST" })
  .middleware([appUserMiddleware])
  .validator(z.object({ id: stationId, consent: z.boolean(), steward: z.string().trim().max(120).default(""), license: z.string().max(40).default("CC BY 4.0") }))
  .handler(async ({ context, data }) => {
    await (await import("./gdex.server")).setConsent(actor(context), data.id, { consent: data.consent, steward: data.steward, license: data.license });
  });

// ── admin console ───────────────────────────────────────────────────────────

export const gdexAdminOverview = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () => (await import("./gdex.server")).adminOverview());

const settingsPatch = z.object({
  title: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(2000).optional(),
  institution: z.string().trim().max(200).optional(),
  creatorName: z.string().trim().max(200).optional(),
  creatorEmail: z.string().trim().max(200).optional(),
  creatorUrl: z.string().trim().max(300).optional(),
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z.string().trim().max(200).optional(),
  license: z.string().max(40).optional(),
  keywords: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  references: z.string().trim().max(500).optional(),
  acknowledgement: z.string().trim().max(500).optional(),
  coordinateDecimals: z.number().int().min(2).max(6).optional(),
  cadence: z.enum(["monthly", "quarterly"]).optional(),
  autoDraft: z.boolean().optional(),
});

export const gdexAdminSaveSettings = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(settingsPatch)
  .handler(async ({ context, data }) => (await import("./gdex.server")).saveSettings(context.profile.userId, data));

/** What a release would hold, without storing it: the quality report an admin reads before building. */
export const gdexAdminPreview = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(z.object({ period }))
  .handler(async ({ data }) => {
    const b = await (await import("./gdex.server")).previewRelease(data.period);
    return {
      ok: b.ok,
      period: b.period,
      rows: b.rows,
      stations: b.stations,
      variables: b.variables,
      issues: b.issues,
      firstTime: b.firstTime,
      lastTime: b.lastTime,
      files: b.files.map((f) => ({ name: f.name, size: f.data.length, sha256: f.sha256 })),
    };
  });

export const gdexAdminBuild = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(z.object({ period }))
  .handler(async ({ context, data }) => {
    const r = await (await import("./gdex.server")).buildAndStore(context.profile.userId, data.period);
    return { ok: r.ok, issues: r.issues, stations: r.stations, rows: r.rows };
  });

export const gdexAdminStatus = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(
    z.object({
      period,
      status: z.enum(["draft", "ready", "submitted", "published"]),
      submissionRef: z.string().trim().max(200).optional(),
      doi: z.string().trim().max(200).optional(),
      notes: z.string().trim().max(2000).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { period: p, status, ...rest } = data;
    await (await import("./gdex.server")).setReleaseStatus(context.profile.userId, p, { status, ...rest });
  });

export const gdexAdminDelete = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(z.object({ period }))
  .handler(async ({ context, data }) => {
    await (await import("./gdex.server")).deleteDraft(context.profile.userId, data.period);
  });

// ── public ──────────────────────────────────────────────────────────────────

/** For the /gdex page. Signed-out visitors may read it: it only describes data that is already public. */
export const gdexPublic = createServerFn({ method: "GET" }).handler(async () => (await import("./gdex.server")).publicSummary(""));
