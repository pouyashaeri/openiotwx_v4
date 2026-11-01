import { createFileRoute } from "@tanstack/react-router";

/** GET /api/stations/:slug/csv?hours=24 — export, same visibility rules as the station page. */
export const Route = createFileRoute("/api/stations/$slug/csv")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const svc = await import("@/lib/platform/service.server");
        const { getSessionUser } = await import("@/lib/auth/verify.server");
        const user = await getSessionUser().catch(() => null);
        const profile = user ? await svc.ensureProfile(user.id).catch(() => null) : null;
        const station = await svc.getStationFor(
          params.slug,
          profile && !profile.suspended ? { userId: profile.userId, role: profile.role } : null,
        );
        if (!station) return new Response("Not found", { status: 404 });
        const hours = Math.min(24 * 365, Math.max(1, Number(new URL(request.url).searchParams.get("hours")) || 24));
        return new Response(await svc.stationCsv(station.id, hours), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${station.slug}.csv"`,
          },
        });
      },
    },
  },
});
