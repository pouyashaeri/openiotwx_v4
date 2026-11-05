import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for the browser: email and password against this site's own `/api/auth/*`.
 *
 * The session is an HttpOnly cookie that only the server can read or clear, so nothing is kept in the browser's own
 * storage, and sign-out is a request the server has to confirm.
 */
export const authClient = createAuthClient();

/**
 * True when sign-in UI should be shown, i.e. whenever `VITE_AUTH_ENABLED` is not `"false"`. Setting it to `"false"`
 * selects the shared dev user (see `use-current-user`); production refuses that.
 */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

/**
 * Sign out of this site, then go to `redirectTo`.
 *
 * It rejects if the server does not confirm: the session is a cookie only the server can clear, so redirecting
 * anyway would claim a sign-out that did not happen. Callers should catch it and let the person try again.
 */
export async function signOut(redirectTo = "/"): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Sign-out failed");
  window.location.href = redirectTo;
}
