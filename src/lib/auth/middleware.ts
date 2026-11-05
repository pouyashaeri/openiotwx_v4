import { createMiddleware } from "@tanstack/react-start";

/**
 * Auth middleware for server functions: the standard way to get the caller's verified user id. The session cookie is
 * same-origin and rides along automatically.
 *
 *   import { createServerFn } from "@tanstack/react-start";
 *   import { getSql } from "@/lib/db";
 *   import { authMiddleware } from "@/lib/auth/middleware";
 *
 *   export const listTodos = createServerFn({ method: "GET" })
 *     .middleware([authMiddleware])
 *     .handler(async ({ context }) => {
 *       const sql = await getSql();
 *       return sql`select * from todos where user_id = ${context.userId}`;
 *     });
 *
 * Signed out -> throws `UnauthorizedError` (see `verify.server.ts`). With auth disabled (`VITE_AUTH_ENABLED=false`) it
 * resolves the shared dev user, but throws instead when a `DATABASE_URL` is also set. Use it on every server function
 * that touches per-user data, and scope every query by `context.userId`.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  // ONLY import `*.server` modules here, so Vite does not ship server code to the browser.
  const { assertSameSiteRequest } = await import("./isolation.server");
  const { requireUserId } = await import("./verify.server");
  // Reject scripted cross-site requests before touching per-user data.
  assertSameSiteRequest();
  const userId = await requireUserId();
  return next({ context: { userId } });
});
