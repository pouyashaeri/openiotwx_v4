import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ROLES, UsageError, listStaff, setRole } from "./make-admin.mjs";

// The site's real schema, applied to an in-memory database: the same files the migrator runs.
async function freshDatabase() {
  const db = new PGlite();
  for (const dir of ["migrations/auth", "migrations"]) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.exec(readFileSync(join(dir, file), "utf8"));
    }
  }
  const query = async (sql, params) => (await db.query(sql, params)).rows;
  return { db, query };
}

async function addPerson(db, id, email, role) {
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, false, now(), now())`,
    [id, email.split("@")[0], email],
  );
  if (role) await db.query("insert into profiles (user_id, email, name, role) values ($1, $2, $3, $4)", [id, email, "x", role]);
}

test("it makes an administrator, case-insensitively, and writes the audit log", async () => {
  const { db, query } = await freshDatabase();
  await addPerson(db, "u1", "Boss@ucar.edu", "user");
  const done = await setRole(query, "  BOSS@UCAR.EDU ", "superadmin", "tester");
  assert.deepEqual(done, { email: "Boss@ucar.edu", from: "user", to: "superadmin" });
  assert.equal((await query("select role from profiles where user_id = 'u1'", []))[0].role, "superadmin");
  const log = await query("select action, target, detail from audit_log", []);
  assert.equal(log.length, 1);
  assert.equal(log[0].action, "admin.cli.set_role");
  assert.equal(log[0].target, "u1");
  assert.deepEqual(log[0].detail, { email: "boss@ucar.edu", from: "user", to: "superadmin", by: "tester" });
});

test("it can make a profile for an account that never opened the site, and take a role away", async () => {
  const { db, query } = await freshDatabase();
  await addPerson(db, "u2", "new@ucar.edu", null); // signed up, never visited a page that makes the profile
  await setRole(query, "new@ucar.edu", "admin");
  assert.equal((await query("select role from profiles where user_id = 'u2'", []))[0].role, "admin");
  await setRole(query, "new@ucar.edu", "user");
  assert.equal((await query("select role from profiles where user_id = 'u2'", []))[0].role, "user");
});

test("it ends the person's open sessions so the new role applies at once", async () => {
  const { db, query } = await freshDatabase();
  await addPerson(db, "u3", "p@ucar.edu", "user");
  await db.query(
    `insert into "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId") values ('s1', now() + interval '1 day', 't1', now(), now(), 'u3')`,
  );
  await setRole(query, "p@ucar.edu", "admin");
  assert.equal((await query(`select count(*)::int as n from "session" where "userId" = 'u3'`, []))[0].n, 0);
});

test("it refuses an unknown person, a bad address and a bad role, and changes nothing", async () => {
  const { db, query } = await freshDatabase();
  await addPerson(db, "u4", "p@ucar.edu", "user");
  await assert.rejects(setRole(query, "nobody@ucar.edu", "admin"), (e) => e instanceof UsageError && /sign up/.test(e.message));
  await assert.rejects(setRole(query, "not-an-email", "admin"), UsageError);
  await assert.rejects(setRole(query, "p@ucar.edu", "root"), UsageError);
  await assert.rejects(setRole(query, "p@ucar.edu", "SUPERADMIN"), UsageError); // exact names only
  assert.equal((await query("select role from profiles where user_id = 'u4'", []))[0].role, "user");
  assert.equal((await query("select count(*)::int as n from audit_log", []))[0].n, 0);
});

test("the list shows only people with a role", async () => {
  const { db, query } = await freshDatabase();
  await addPerson(db, "a", "a@ucar.edu", "superadmin");
  await addPerson(db, "b", "b@ucar.edu", "admin");
  await addPerson(db, "c", "c@ucar.edu", "user");
  assert.deepEqual((await listStaff(query)).map((r) => `${r.role} ${r.email}`), ["superadmin a@ucar.edu", "admin b@ucar.edu"]);
  assert.deepEqual(ROLES, ["user", "admin", "superadmin"]);
});
