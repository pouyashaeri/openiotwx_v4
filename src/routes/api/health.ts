import { createFileRoute } from "@tanstack/react-router";

/** GET /api/health — liveness + database check for load balancers and Docker. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getSql } = await import("@/lib/db");
          const sql = await getSql();
          await sql`select 1`;
          const { ingestStats } = await import("@/lib/platform/ingest.server");
          const s = ingestStats();
          return Response.json({ ok: true, buffered: s.buffered, errors: s.errors });
        } catch (err) {
          return Response.json({ ok: false, error: err instanceof Error ? err.message : "db" }, { status: 503 });
        }
      },
    },
  },
});
