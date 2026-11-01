import { createFileRoute } from "@tanstack/react-router";

/** /instruments/<id>.csv|json|geojson — CHORDS-style download. */
export const Route = createFileRoute("/instruments/$file")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        (await import("@/lib/platform/chords-http.server")).instrumentData(request, params.file),
    },
  },
});
