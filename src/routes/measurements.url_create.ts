import { createFileRoute } from "@tanstack/react-router";

/** CHORDS-compatible upload, so devices already set up for a CHORDS portal work unchanged. */
export const Route = createFileRoute("/measurements/url_create")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/platform/chords-http.server")).urlCreate(request),
      POST: async ({ request }) => (await import("@/lib/platform/chords-http.server")).urlCreate(request),
    },
  },
});
