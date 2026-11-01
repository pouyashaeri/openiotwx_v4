import { createFileRoute } from "@tanstack/react-router";

/** /api/v1/data/<id>.csv|json|geojson — the newer CHORDS path, same data. */
export const Route = createFileRoute("/api/v1/data/$file")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        (await import("@/lib/platform/chords-http.server")).instrumentData(request, params.file),
    },
  },
});
