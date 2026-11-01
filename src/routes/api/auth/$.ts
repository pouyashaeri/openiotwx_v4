import { createFileRoute } from "@tanstack/react-router";
import { SESSION_TOKEN_COOKIE, auth } from "@/lib/auth/server";
import { withoutSessionCache } from "@/lib/auth/session-cache";

/**
 * Mount Better Auth at /api/auth/*.
 *
 * Better Auth sets several cookies on sign-in/out (session token, cached
 * session data, …) but the Start dev server forwards only the LAST Set-Cookie of
 * a returned Response, which would drop the session token itself. The token is
 * the only cookie that matters (the data cookie is just a read cache), so keep
 * exactly that one. Sessions then resolve from the database, which is correct
 * and still fast on Postgres.
 */
async function handle(request: Request): Promise<Response> {
  // Never trust the stale cache cookie: see session-cache.ts.
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const clean = new Request(request.url, {
    method: request.method,
    headers: withoutSessionCache(request.headers),
    body: hasBody ? await request.arrayBuffer() : undefined,
  });
  const res = await auth.handler(clean);
  const cookies = res.headers.getSetCookie();
  if (cookies.length < 2) return res;
  const token = cookies.find((c) => c.startsWith(`${SESSION_TOKEN_COOKIE}=`));
  if (!token) return res;
  const headers = new Headers(res.headers);
  headers.set("set-cookie", token);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
