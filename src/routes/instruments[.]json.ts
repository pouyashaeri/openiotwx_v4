import { createFileRoute } from "@tanstack/react-router";

/** CHORDS-compatible listing of the stations that chose to share. */
export const Route = createFileRoute("/instruments.json")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/platform/chords-http.server")).listInstruments(request),
    },
  },
});
