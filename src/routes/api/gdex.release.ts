import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/gdex/release: the scheduler calls this (daily is fine) with the shared token. It builds the
 * DRAFT for the period that just ended, once. It never marks anything ready: a person does that.
 *   x-gdex-token: <GDEX_RELEASE_TOKEN>
 *   body (optional): {"period": "2026-10"} to build a specific finished period
 */
export const Route = createFileRoute("/api/gdex/release")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.GDEX_RELEASE_TOKEN?.trim();
        if (!expected) return Response.json({ error: "GDEX_RELEASE_TOKEN is not set on the server" }, { status: 503 });
        const given = request.headers.get("x-gdex-token") ?? "";
        const { timingSafeEqual } = await import("node:crypto");
        const a = Buffer.from(given);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "Wrong token" }, { status: 401 });
        const { buildDue, buildAndStore } = await import("@/lib/gdex/gdex.server");
        try {
          const body = (await request.json().catch(() => ({}))) as { period?: unknown };
          if (typeof body.period === "string") {
            const r = await buildAndStore(null, body.period);
            return Response.json({
              period: body.period,
              action: r.ok ? "built" : "blocked",
              stations: r.stations,
              observations: r.rows,
              issues: r.issues.filter((i) => i.severity !== "info"),
            });
          }
          return Response.json(await buildDue());
        } catch (err) {
          return Response.json({ error: err instanceof Error ? err.message : "Could not build the release" }, { status: 400 });
        }
      },
    },
  },
});
