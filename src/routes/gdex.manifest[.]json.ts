import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /gdex/manifest.json: the list GDEX polls to find releases. Each file has a URL, a size and a
 * SHA-256, so a pull can be checked. Only releases an admin marked ready (or later) appear.
 */
export const Route = createFileRoute("/gdex/manifest.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { manifest } = await import("@/lib/gdex/gdex.server");
        return Response.json(await manifest(new URL(request.url).origin), {
          headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
        });
      },
    },
  },
});
