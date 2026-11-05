import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/health — liveness + database check for load balancers and Docker.
 * It also fails when a production server has an unsafe configuration, so an orchestrator never marks such a
 * server ready. The reason goes to the server log, never to the caller: this route is open to anyone.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { assertProductionConfig } = await import("@/lib/security/policy");
          assertProductionConfig();
          const { getSql } = await import("@/lib/db");
          const sql = await getSql();
          await sql`select 1`;
          const { ingestStats } = await import("@/lib/platform/ingest.server");
          const s = ingestStats();
          return Response.json({ ok: true, buffered: s.buffered, errors: s.errors });
        } catch (err) {
          console.error("[health] not healthy:", err);
          return Response.json({ ok: false }, { status: 503 });
        }
      },
    },
  },
});
