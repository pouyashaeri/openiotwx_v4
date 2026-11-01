import { createFileRoute } from "@tanstack/react-router";

/**
 * The community hub: the API behind the Plan, Analysis, Forecast and Community pages
 * (see src/lib/hub/hub.server.ts). Everything under /hub is handled there.
 */
async function run(request: Request, params: { _splat?: string }) {
  const { handleHub } = await import("@/lib/hub/hub.server");
  try {
    return await handleHub(request, params._splat ?? "");
  } catch (err) {
    console.error("[hub]", err);
    return Response.json({ detail: "Internal error" }, { status: 500 });
  }
}

export const Route = createFileRoute("/hub/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => run(request, params),
      POST: ({ request, params }) => run(request, params),
      PUT: ({ request, params }) => run(request, params),
    },
  },
});
