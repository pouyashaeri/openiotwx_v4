import { getRequest } from "@tanstack/react-start/server";
import { withoutSessionCache } from "./session-cache";
import { auth, authConfigured } from "./server";

/**
 * Server-side session resolution (server-only).
 *
 * This site runs its OWN Better Auth at same-origin `/api/auth/*`, so the session cookie is sent with every request:
 * server functions and server-rendered pages included. The user is resolved straight from the request cookies with
 * `auth.api.getSession`. Never trust a client-supplied user id, only the result of this verification.
 */

/** True when a real database is configured server-side. */
const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());

/** Re-export so callers can branch on it without importing `server.ts`. */
export { authConfigured };

if (databaseConfigured && !authConfigured) {
  console.error(
    "[auth] DATABASE_URL is set but auth is disabled (VITE_AUTH_ENABLED=false). " +
      "requireUserId() will reject every request (fail closed) rather than share one dev user on a real database.",
  );
}

/** Development fallback user id, used only when auth is disabled (VITE_AUTH_ENABLED=false) and there is no database. */
export const DEV_USER_ID = "dev-user";

/**
 * Thrown by `requireUserId` when the caller has no valid session. Carries `status: 401`; the message is a stable
 * contract: match `err.message === "Unauthorized"` client-side to send the visitor to sign-in.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type VerifiedUser = { id: string; email: string | null };

/**
 * The signed-in user of the current request, or `null` when auth is off or nobody is signed in. Safe to call from
 * server functions and server-rendered pages.
 */
export async function getSessionUser(): Promise<VerifiedUser | null> {
  if (!authConfigured) return null;
  const request = getRequest();
  if (!request) return null;
  const session = await auth.api.getSession({ headers: withoutSessionCache(request.headers) });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

/**
 * The current user id for a server function, or a thrown `UnauthorizedError` when signed out. Prefer
 * `authMiddleware` (`./middleware`), which calls this for you.
 *  - Auth on: the verified session user id.
 *  - Auth disabled (`VITE_AUTH_ENABLED=false`) with `DATABASE_URL` set: throws (fail closed), because one shared dev
 *    user on a real database would let every visitor read and write everyone's rows.
 *  - Auth disabled, no database: the shared dev user id.
 */
export async function requireUserId(): Promise<string> {
  if (!authConfigured) {
    if (databaseConfigured) {
      throw new Error(
        "Auth is disabled (VITE_AUTH_ENABLED=false) but DATABASE_URL is set. Refusing to fall back to the shared dev user against a real database.",
      );
    }
    return DEV_USER_ID;
  }
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user.id;
}
