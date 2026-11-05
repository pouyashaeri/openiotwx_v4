/**
 * This site's own Better Auth (server-only): email and password, sessions in the database.
 *
 * It runs at same-origin `/api/auth/*`, so the session cookie stays on this site's own address. There is no
 * third-party sign-in, no broker and no preview mode: the people who can sign in are the ones in this database.
 *
 * NEVER import this from client code: it pulls in `pg` and the server side of Better Auth. The browser uses
 * `@/lib/auth/client`; components read the user through `@/lib/auth/use-current-user`; server functions get a
 * verified user id from `@/lib/auth/middleware`.
 *
 * In production the server refuses to run with an unsafe configuration (security/policy.ts): a real database, a long
 * random BETTER_AUTH_SECRET, and BETTER_AUTH_URL set to the public https address, which is the only address allowed
 * to sign in.
 */
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import { assertProductionConfig, isProduction } from "../security/policy";
import { pgliteDialect } from "./pglite-dialect";

// A production server with an unsafe configuration does not start (see security/policy.ts).
assertProductionConfig();

// Kick (and share) the embedded-database bootstrap as soon as the auth server module loads.
void ensureDbReady();

/** Read an env var, treating empty/whitespace as unset. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

/**
 * Development only: a signing secret that lives as long as the process, so a hot reload does not sign everyone out.
 * Production never gets here: it must set BETTER_AUTH_SECRET (checked above).
 */
const globalAuthRef = globalThis as typeof globalThis & { __devAuthSecret__?: string };
function developmentSecret(): string {
  globalAuthRef.__devAuthSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__devAuthSecret__;
}

// Sign-in is on unless explicitly switched off. `VITE_AUTH_ENABLED=false` is a development switch (one shared dev
// user); production refuses it.
const authDisabled = env("VITE_AUTH_ENABLED") === "false";

/** True when sign-in is enforced. */
export const authConfigured = !authDisabled;

// This site's own address. In production it is BETTER_AUTH_URL, always. In development without it, the address is
// worked out from the request, but only for loopback hosts.
const explicitBaseURL = env("BETTER_AUTH_URL");
// Local `npm run dev` (port 8080). Browsers may send Origin as any of these for the same server.
const LOCAL_DEV_ORIGINS: string[] = ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"];
const baseURL = explicitBaseURL ?? {
  allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

// Origins Better Auth accepts on credentialed POSTs (sign-up/sign-in, ...). Missing entries surface as FORBIDDEN
// "Invalid origin". In production the only trusted origin is the site's own public address.
const trustedOrigins: string[] = explicitBaseURL
  ? isProduction(process.env)
    ? [explicitBaseURL]
    : [explicitBaseURL, ...LOCAL_DEV_ORIGINS]
  : LOCAL_DEV_ORIGINS;

const databaseUrl = env("DATABASE_URL");

// Real Postgres when DATABASE_URL is set (production), else the embedded development database. Both use the Better
// Auth schema from migrations/0001_auth.sql.
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

/** Session token cookie name. `__Host-` makes the browser refuse a same-named cookie that carries a Domain. */
export const SESSION_TOKEN_COOKIE = "__Host-openiotwx.session_token";

export const auth = betterAuth({
  baseURL,
  secret: env("BETTER_AUTH_SECRET") ?? developmentSecret(),
  database,

  // CSRF / origin check for credentialed auth POSTs. See `trustedOrigins` above.
  trustedOrigins,

  // Cache the session in the short-lived signed `session_data` cookie so reads skip the database. (The auth route
  // never delivers that cookie, see src/routes/api/auth/$.ts, so every lookup goes to the database in practice.)
  session: { cookieCache: { enabled: true, maxAge: 300 } },

  // Passwords: at least 10 characters. Sign-in and sign-up are rate limited per address in production (the limiter is
  // on by default there and off in development, so the test suites can sign up freely).
  emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
  rateLimit: {
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 3600, max: 20 },
      "/change-password": { window: 600, max: 5 },
    },
  },

  // `__Host-` cookies: Secure, Path=/, no Domain, so no other site on the same domain can plant a session cookie here.
  // (Browsers allow Secure cookies on http://localhost, so local development still works.)
  advanced: {
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "__Host-openiotwx.session_data" },
      account_data: { name: "__Host-openiotwx.account_data" },
      dont_remember: { name: "__Host-openiotwx.dont_remember" },
    },
  },

  // Bridges Better Auth's Set-Cookie into TanStack Start responses. Must be last.
  plugins: [tanstackStartCookies()],
});
