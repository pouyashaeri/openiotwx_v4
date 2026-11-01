import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /gdex/releases/:period/:file: a release file. Ready, submitted and published releases are public
 * (they hold only data whose stewards consented). A draft is visible to staff only.
 */
export const Route = createFileRoute("/gdex/releases/$period/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { releaseFile, isPublicStatus } = await import("@/lib/gdex/gdex.server");
        const f = await releaseFile(params.period, decodeURIComponent(params.file));
        if (!f) return new Response("Not found", { status: 404 });
        if (!isPublicStatus(f.status)) {
          const { getSessionUser } = await import("@/lib/auth/verify.server");
          const { ensureProfile, isStaff } = await import("@/lib/platform/service.server");
          const user = await getSessionUser().catch(() => null);
          const p = user ? await ensureProfile(user.id).catch(() => null) : null;
          if (!p || p.suspended || !isStaff(p.role)) return new Response("Not found", { status: 404 });
        }
        return new Response(f.data as BodyInit, {
          headers: {
            "content-type": f.contentType,
            "content-length": String(f.data.length),
            "content-disposition": `attachment; filename="${params.file.replace(/"/g, "")}"`,
            etag: `"${f.sha256}"`,
            "x-content-sha256": f.sha256,
            "cache-control": f.status === "draft" ? "private, no-store" : "public, max-age=86400",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
