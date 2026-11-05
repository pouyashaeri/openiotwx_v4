import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configProblems, decideRole, emailList, type RoleInput } from "./policy.ts";

const base: RoleInput = { email: "boss@ucar.edu", emailVerified: false, superEmails: [], adminEmails: [], production: true, staffExists: false };

describe("who becomes an administrator", () => {
  it("in production the first account is just a user", () => {
    assert.equal(decideRole({ ...base }), "user");
    assert.equal(decideRole({ ...base, emailVerified: true }), "user");
  });

  it("in production a listed address gets nothing until it is verified", () => {
    const listed = { ...base, superEmails: ["boss@ucar.edu"] };
    assert.equal(decideRole(listed), "user"); // someone who typed the address in at sign-up
    assert.equal(decideRole({ ...listed, emailVerified: true }), "superadmin");
    assert.equal(decideRole({ ...base, adminEmails: ["boss@ucar.edu"], emailVerified: true }), "admin");
    assert.equal(decideRole({ ...base, adminEmails: ["boss@ucar.edu"] }), "user");
  });

  it("matches the address regardless of case and spaces", () => {
    assert.equal(decideRole({ ...base, email: "  Boss@UCAR.edu ", superEmails: ["boss@ucar.edu"], emailVerified: true }), "superadmin");
  });

  it("another person is not promoted by someone else's entry", () => {
    assert.equal(decideRole({ ...base, email: "intruder@example.org", superEmails: ["boss@ucar.edu"], emailVerified: true }), "user");
  });

  it("in development a fresh install is not locked out", () => {
    const dev = { ...base, production: false };
    assert.equal(decideRole(dev), "superadmin"); // the first account
    assert.equal(decideRole({ ...dev, staffExists: true }), "user"); // later accounts
    assert.equal(decideRole({ ...dev, superEmails: ["boss@ucar.edu"] }), "superadmin"); // listed, no verification needed
    assert.equal(decideRole({ ...dev, email: "x@y.z", superEmails: ["boss@ucar.edu"] }), "user"); // lists configured: no first-account rule
  });
});

describe("emailList", () => {
  it("reads a comma list", () => {
    assert.deepEqual(emailList(" A@b.c, d@e.f ,,"), ["a@b.c", "d@e.f"]);
    assert.deepEqual(emailList(undefined), []);
  });
});

const good = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@db:5432/x",
  BETTER_AUTH_SECRET: "x".repeat(8) + "Qz9!mK2" + "r".repeat(20),
  BETTER_AUTH_URL: "https://openiotwx.example.org",
};

describe("a production server will not start unsafe", () => {
  it("development has no rules", () => {
    assert.deepEqual(configProblems({ NODE_ENV: "development" }).errors, []);
    assert.deepEqual(configProblems({}).errors, []);
  });

  it("a proper configuration passes", () => {
    assert.deepEqual(configProblems(good).errors, []);
  });

  it("needs a database, a real secret and the public address", () => {
    assert.ok(configProblems({ NODE_ENV: "production" }).errors.length >= 3);
    assert.ok(configProblems({ ...good, DATABASE_URL: "" }).errors.some((e) => /DATABASE_URL/.test(e)));
    assert.ok(configProblems({ ...good, BETTER_AUTH_SECRET: "short" }).errors.some((e) => /shorter than 32/.test(e)));
    assert.ok(configProblems({ ...good, BETTER_AUTH_SECRET: "change-me" }).errors.length > 0);
    assert.ok(configProblems({ ...good, BETTER_AUTH_SECRET: "change-me-too" }).errors.length > 0);
    assert.ok(configProblems({ ...good, BETTER_AUTH_URL: "" }).errors.some((e) => /BETTER_AUTH_URL/.test(e)));
  });

  it("insists on https except for localhost", () => {
    assert.ok(configProblems({ ...good, BETTER_AUTH_URL: "http://openiotwx.example.org" }).errors.some((e) => /https/.test(e)));
    assert.deepEqual(configProblems({ ...good, BETTER_AUTH_URL: "http://localhost" }).errors, []);
    assert.ok(configProblems({ ...good, BETTER_AUTH_URL: "not a url" }).errors.length > 0);
  });

  it("refuses development switches", () => {
    assert.ok(configProblems({ ...good, VITE_AUTH_ENABLED: "false" }).errors.length > 0);
    assert.ok(configProblems({ ...good, CHORDS_ALLOW_PRIVATE: "1" }).errors.length > 0);
  });

  it("refuses weak service tokens, and allows the embedded database only when asked", () => {
    assert.ok(configProblems({ ...good, HUB_TOKEN: "abc" }).errors.some((e) => /HUB_TOKEN/.test(e)));
    assert.deepEqual(configProblems({ ...good, HUB_TOKEN: "t".repeat(32) }).errors, []);
    const noDb = { ...good, DATABASE_URL: undefined };
    assert.ok(configProblems(noDb).errors.length > 0);
    assert.deepEqual(configProblems({ ...noDb, ALLOW_EMBEDDED_DB: "1" }).errors, []);
  });

  it("warns, but does not stop, about admin email lists", () => {
    const r = configProblems({ ...good, SUPERADMIN_EMAILS: "boss@ucar.edu" });
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.some((w) => /make-admin/.test(w)));
  });
});
