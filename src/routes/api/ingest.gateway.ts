import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/ingest/gateway — accepts the legacy Pi LoRa gateway's messages
 * (one object or an array of `{station_id, sensor, measurement, reading_value, timestamp}`).
 * Position packets (latitude / longitude / altitude, or `station_info`) move the station on the map.
 *   x-api-key: iotwx_…
 */
export const Route = createFileRoute("/api/ingest/gateway")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { ingest, IngestError, stationIdForKey } = await import("@/lib/platform/ingest.server");
        const { fromGateway } = await import("@/lib/legacy/gateway");
        const auth = request.headers.get("authorization");
        const key = request.headers.get("x-api-key") ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : null);
        try {
          let input: unknown;
          try {
            input = await request.json();
          } catch {
            throw new IngestError(400, "Body must be JSON");
          }
          // Authenticate first, so a bad key is a 401 whatever the message holds.
          const id = await stationIdForKey(key);
          if (!id) throw new IngestError(401, "Unknown or disabled station key");
          const { body, position, skipped } = fromGateway(input);
          if (position) await (await import("@/lib/platform/service.server")).setStationPosition(id, position);
          if (!body.readings.length) {
            if (!position) throw new IngestError(400, "No readings in this message");
            return Response.json({ accepted: 0, rejected: 0, skipped, position: true }, { status: 202 });
          }
          const result = await ingest(key, body);
          return Response.json({ ...result, skipped, position: Boolean(position) }, { status: 202 });
        } catch (err) {
          if (err instanceof IngestError) {
            return Response.json({ error: err.message }, { status: err.status });
          }
          console.error("[ingest/gateway]", err);
          return Response.json({ error: "Internal error" }, { status: 500 });
        }
      },
    },
  },
});
