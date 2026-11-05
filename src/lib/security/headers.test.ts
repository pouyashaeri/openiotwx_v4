import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./headers.ts";

const directive = (name: string) => CONTENT_SECURITY_POLICY.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("security headers", () => {
  it("sets all the standard protections", () => {
    for (const name of ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
      assert.ok(SECURITY_HEADERS[name], name);
    }
    assert.equal(SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
    assert.equal(SECURITY_HEADERS["X-Frame-Options"], "DENY");
  });

  it("lets nothing embed the site and closes the side doors", () => {
    assert.equal(directive("frame-ancestors"), "frame-ancestors 'none'");
    assert.equal(directive("object-src"), "object-src 'none'");
    assert.equal(directive("base-uri"), "base-uri 'self'");
    assert.equal(directive("form-action"), "form-action 'self'");
    assert.ok(directive("default-src").includes("'self'"));
  });

  it("allows no eval and no scripts from other sites", () => {
    const scripts = directive("script-src");
    assert.ok(!scripts.includes("unsafe-eval"));
    assert.ok(!/https?:\/\//.test(scripts));
    assert.ok(!scripts.includes("*"));
  });

  it("only talks to https services, never plain http or websockets", () => {
    const connect = directive("connect-src");
    assert.ok(connect.includes("https:"));
    assert.ok(!connect.includes("http:") || connect.includes("https:") === true);
    assert.ok(!/\bws:|\bwss:|http:\/\//.test(connect));
  });

  it("keeps the two browser features the app needs, and no others", () => {
    const p = SECURITY_HEADERS["Permissions-Policy"];
    assert.ok(p.includes("geolocation=(self)"));
    assert.ok(p.includes("serial=(self)"));
    assert.ok(p.includes("camera=()") && p.includes("microphone=()"));
  });

  it("does not claim the rest of the domain for HSTS", () => {
    assert.ok(!SECURITY_HEADERS["Strict-Transport-Security"].includes("includeSubDomains"));
  });
});
