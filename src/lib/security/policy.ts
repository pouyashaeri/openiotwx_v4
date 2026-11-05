/**
 * The security rules that decide who is an administrator and whether the server may start.
 * Plain functions with no I/O, so they can be tested directly (policy.test.ts).
 *
 * The idea: in production nobody becomes an administrator by being first, or by typing an email address.
 * An administrator is made on purpose, by someone with access to the server or its database
 * (scripts/make-admin.mjs). In development the old conveniences stay, so a fresh checkout still works.
 */

export type Role = "user" | "admin" | "superadmin";

export type RoleInput = {
  /** The account's email address, as stored. */
  email: string;
  /** Has the address been proven (a verification email was followed)? */
  emailVerified: boolean;
  /** SUPERADMIN_EMAILS and ADMIN_EMAILS, already trimmed and lower-cased. */
  superEmails: string[];
  adminEmails: string[];
  production: boolean;
  /** Does an administrator or super-administrator exist already? */
  staffExists: boolean;
};

/**
 * The role a new account starts with.
 *
 * Production: always "user". A configured email list only counts for an address that has been verified, so
 * someone who signs up with an administrator's address before the administrator does gets nothing. The first
 * account is not special.
 *
 * Development: a listed address gets its role at once, and when nothing is configured the first account is
 * the super-administrator, so a fresh install is never locked out.
 */
export function decideRole(i: RoleInput): Role {
  const email = i.email.trim().toLowerCase();
  const listedSuper = i.superEmails.includes(email);
  const listedAdmin = i.adminEmails.includes(email);
  const trusted = i.production ? i.emailVerified : true;
  if (listedSuper && trusted) return "superadmin";
  if (listedAdmin && trusted) return "admin";
  const unconfigured = i.superEmails.length === 0 && i.adminEmails.length === 0;
  if (!i.production && unconfigured && !i.staffExists) return "superadmin";
  return "user";
}

/** A comma-separated environment list, trimmed and lower-cased. */
export function emailList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

type Env = Record<string, string | undefined>;

const PLACEHOLDER_SECRETS = ["change-me", "change-me-too", "changeme", "secret", "password", "openiotwx-dev-only-secret"];

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === "production";
}

/**
 * What is wrong with this configuration, if it is a production one. `errors` stop the server from starting;
 * `warnings` are logged. Development has neither.
 */
export function configProblems(env: Env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isProduction(env)) return { errors, warnings };
  const set = (k: string) => (env[k] ?? "").trim();

  if (!set("DATABASE_URL") && set("ALLOW_EMBEDDED_DB") !== "1") {
    errors.push("DATABASE_URL is not set. Production needs a real Postgres database; the embedded one forgets nothing safely and is for development.");
  }

  const secret = set("BETTER_AUTH_SECRET");
  if (!secret) errors.push("BETTER_AUTH_SECRET is not set. It signs every session; make a long random one (openssl rand -base64 48).");
  else if (secret.length < 32) errors.push("BETTER_AUTH_SECRET is shorter than 32 characters.");
  else if (PLACEHOLDER_SECRETS.includes(secret.toLowerCase())) errors.push("BETTER_AUTH_SECRET is still the example value.");

  const url = set("BETTER_AUTH_URL");
  if (!url) errors.push("BETTER_AUTH_URL is not set. It must be the public address of the site, for example https://openiotwx.example.org.");
  else {
    try {
      const u = new URL(url);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
      if (u.protocol !== "https:" && !local) errors.push("BETTER_AUTH_URL must start with https:// (plain http is only allowed for localhost).");
    } catch {
      errors.push("BETTER_AUTH_URL is not a valid web address.");
    }
  }

  if (set("VITE_AUTH_ENABLED") === "false") errors.push("VITE_AUTH_ENABLED=false turns sign-in off. It is only for development.");
  if (set("CHORDS_ALLOW_PRIVATE") === "1") errors.push("CHORDS_ALLOW_PRIVATE=1 lets the importer reach private network addresses. Never set it in production.");

  for (const name of ["HUB_TOKEN", "INGEST_BRIDGE_TOKEN", "GDEX_RELEASE_TOKEN"]) {
    const v = set(name);
    if (v && v.length < 24) errors.push(`${name} is shorter than 24 characters. Use a long random value.`);
  }
  const pg = set("POSTGRES_PASSWORD");
  if (pg && (pg.length < 12 || PLACEHOLDER_SECRETS.includes(pg.toLowerCase()))) warnings.push("POSTGRES_PASSWORD looks weak or is the example value.");

  if (set("SUPERADMIN_EMAILS") || set("ADMIN_EMAILS")) {
    warnings.push(
      "SUPERADMIN_EMAILS / ADMIN_EMAILS only apply to verified email addresses in production. Make an administrator with scripts/make-admin.mjs.",
    );
  }
  return { errors, warnings };
}

let checked = false;

/** Refuse to run a production server with an unsafe configuration. Cheap; safe to call from several places. */
export function assertProductionConfig(env: Env = process.env): void {
  const { errors, warnings } = configProblems(env);
  if (!checked) {
    checked = true;
    for (const w of warnings) console.warn(`[security] ${w}`);
  }
  if (errors.length) {
    throw new Error(`Unsafe production configuration, the server will not start:\n - ${errors.join("\n - ")}`);
  }
}
