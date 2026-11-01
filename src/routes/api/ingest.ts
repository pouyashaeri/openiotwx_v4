import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/ingest — station upload.
 *   x-api-key: iotwx_…
 *   {"values":{"temp_c":21.4,"humidity_pct":40}}                 (ts optional)
 *   {"readings":[{"ts":"2026-01-01T00:00:00Z","values":{…}}, …]}  (≤ 500)
 */
export const Route = createFileRoute("/api/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { ingest, IngestError } = await import("@/lib/platform/ingest.server");
        const auth = request.headers.get("authorization");
        const key = request.headers.get("x-api-key") ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : null);
        try {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            throw new IngestError(400, "Body must be JSON");
          }
          const result = await ingest(key, body);
          return Response.json(result, { status: 202 });
        } catch (err) {
          if (err instanceof IngestError) {
            return Response.json(
              { error: err.message },
              { status: err.status, headers: err.retryAfter ? { "retry-after": String(err.retryAfter) } : {} },
            );
          }
          console.error("[ingest]", err);
          return Response.json({ error: "Internal error" }, { status: 500 });
        }
      },
    },
  },
});
