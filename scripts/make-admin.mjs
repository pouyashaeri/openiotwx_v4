#!/usr/bin/env node
/**
 * Make an administrator on purpose.
 *
 * In production nobody becomes an administrator by being the first to sign up, or by typing an email address.
 * An administrator is made by someone with access to the server (or its database), with this command:
 *
 *   DATABASE_URL=postgres://... node scripts/make-admin.mjs person@ucar.edu superadmin
 *   DATABASE_URL=postgres://... node scripts/make-admin.mjs person@ucar.edu admin
 *   DATABASE_URL=postgres://... node scripts/make-admin.mjs person@ucar.edu user      (take the role away)
 *   DATABASE_URL=postgres://... node scripts/make-admin.mjs --list                    (who has a role now)
 *
 * The person signs up on the site first, so the account exists. On Kubernetes, run it inside the app's pod:
 *
 *   kubectl exec -it deploy/openiotwx -- node scripts/make-admin.mjs person@ucar.edu superadmin
 *
 * Every change is written to the audit log. The same thing in plain SQL, for a database console:
 *
 *   update profiles set role = 'superadmin' where lower(email) = lower('person@ucar.edu');
 */
import { pathToFileURL } from "node:url";

export const ROLES = ["user", "admin", "superadmin"];

/** A message for the person at the terminal; thrown for anything that is their mistake to fix. */
export class UsageError extends Error {}

/** Everyone with a role above "user". `query(sql, params)` resolves to the rows. */
export async function listStaff(query) {
  return query("select email, name, role, suspended from profiles where role <> 'user' order by role desc, email", []);
}

/** Set one account's role. Returns what happened. */
export async function setRole(query, rawEmail, role, by = "unknown") {
  const email = String(rawEmail ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UsageError(`That does not look like an email address: ${rawEmail}`);
  if (!ROLES.includes(role)) throw new UsageError(`The role must be one of: ${ROLES.join(", ")}`);

  const found = await query(`select id, email, name from "user" where lower(email) = $1`, [email]);
  const person = found[0];
  if (!person) throw new UsageError(`No account for ${email}. They have to sign up on the site first, then run this again.`);

  const before = await query("select role from profiles where user_id = $1", [person.id]);
  await query(
    `insert into profiles (user_id, email, name, role) values ($1, $2, $3, $4)
     on conflict (user_id) do update set role = excluded.role`,
    [person.id, person.email, person.name ?? "", role],
  );
  await query("insert into audit_log (actor_id, action, target, detail) values (null, $1, $2, $3::jsonb)", [
    "admin.cli.set_role",
    person.id,
    JSON.stringify({ email, from: before[0]?.role ?? null, to: role, by }),
  ]);
  // A session keeps its old role for a few minutes; end it so the change is immediate.
  await query(`delete from "session" where "userId" = $1`, [person.id]);
  return { email: person.email, from: before[0]?.role ?? null, to: role };
}

const sentence = (role) => (role === "user" ? "a regular user" : role === "admin" ? "an admin" : "a super-admin");

async function main() {
  const args = process.argv.slice(2);
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) throw new UsageError("DATABASE_URL is not set. Point it at the site's Postgres database.");
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    throw new UsageError("Usage: node scripts/make-admin.mjs <email> <superadmin|admin|user>\n       node scripts/make-admin.mjs --list");
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const query = async (text, params) => (await client.query(text, params)).rows;
  try {
    if (args[0] === "--list") {
      const rows = await listStaff(query);
      if (!rows.length) console.log("Nobody has an administrator role yet.");
      for (const r of rows) console.log(`${r.role.padEnd(10)} ${r.email}${r.suspended ? "  (suspended)" : ""}`);
      return;
    }
    const done = await setRole(query, args[0], args[1], process.env.USER || process.env.USERNAME || "unknown");
    console.log(`${done.email} is now ${sentence(done.to)}. Their open sessions were ended, so they sign in again to get the new role.`);
  } finally {
    await client.end();
  }
}

// Run only when called as a command, not when the tests import it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof UsageError ? error.message : `Failed: ${error.message}`);
    process.exit(1);
  });
}
