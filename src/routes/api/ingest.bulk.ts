import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

/**
 * POST /api/ingest/bulk — used by the MQTT bridge, not by stations.
 *   x-bridge-token: $INGEST_BRIDGE_TOKEN
 *   {"items":[{"key":"iotwx_…","body":{…}}, …]}  → per-item status codes
 *   An item may carry {"gateway":"<station id>","body":<Pi gateway message>} instead of a key; the
 *   station is found by the gateway id its owner registered.
 * Each item is authenticated and rate-limited exactly like a direct upload.
 */
export const Route = createFileRoute("/api/ingest/bulk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.INGEST_BRIDGE_TOKEN;
        const given = request.headers.get("x-bridge-token") ?? "";
        const ok =
          Boolean(expected) &&
          given.length === expected!.length &&
          timingSafeEqual(Buffer.from(given), Buffer.from(expected!));
        if (!ok) return Response.json({ error: "Forbidden" }, { status: 403 });
        const { ingest, IngestError, stationIdForGateway } = await import("@/lib/platform/ingest.server");
        const { fromGateway } = await import("@/lib/legacy/gateway");
        const payload = (await request.json().catch(() => null)) as {
          items?: { key?: string; gateway?: string; body: unknown }[];
        } | null;
        const items = Array.isArray(payload?.items) ? payload!.items!.slice(0, 1000) : [];
        const results: number[] = [];
        for (const item of items) {
          try {
            if (typeof item.gateway === "string") {
              const id = await stationIdForGateway(item.gateway);
              if (!id) throw new IngestError(404, "No station registered for this gateway id");
              const { body, position } = fromGateway(item.body);
              if (position) await (await import("@/lib/platform/service.server")).setStationPosition(id, position);
              if (body.readings.length) await ingest(null, body, { gatewayId: item.gateway });
            } else {
              await ingest(typeof item.key === "string" ? item.key : null, item.body);
            }
            results.push(202);
          } catch (err) {
            results.push(err instanceof IngestError ? err.status : 500);
          }
        }
        return Response.json({ results });
      },
    },
  },
});
