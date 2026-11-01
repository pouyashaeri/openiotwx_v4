import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, createRateLimiter, oneLine, supportMailto, validateSupport } from "./info.ts";
import { composeMail, type StoredMessage } from "./mail.ts";

const good = { name: "Sam", email: "sam@example.org", topic: "station", message: "My station stopped reporting last night." };

test("a good message passes, and each problem is named in the site's own words", () => {
  assert.equal(validateSupport(good), null);
  assert.equal(validateSupport({ ...good, name: "  " })?.field, "name");
  assert.equal(validateSupport({ ...good, email: "not-an-email" })?.field, "email");
  assert.equal(validateSupport({ ...good, email: "a b@c.org" })?.field, "email");
  assert.equal(validateSupport({ ...good, topic: "" })?.field, "topic");
  assert.equal(validateSupport({ ...good, topic: "weather" })?.field, "topic");
  assert.equal(validateSupport({ ...good, message: "help" })?.field, "message");
  assert.match(validateSupport({ ...good, message: "help" })?.message ?? "", /a little more/);
  assert.equal(validateSupport({ ...good, message: "x".repeat(LIMITS.messageMax + 1) })?.field, "message");
  assert.equal(validateSupport({ ...good, name: "x".repeat(LIMITS.name + 1) })?.field, "name");
});

test("oneLine makes a header value a single line", () => {
  assert.equal(oneLine("Sam\r\nBcc: boss@example.org"), "Sam Bcc: boss@example.org");
  assert.equal(oneLine("a\nb\tc\u0000d"), "a b c d");
  assert.equal(oneLine("a" + String.fromCharCode(0x2028) + "b"), "a b");
  assert.equal(oneLine("  spaced   out  "), "spaced out");
  assert.equal(oneLine("x".repeat(500), 20).length, 20);
});

test("the email never lets a field start another header, and replies go to the sender", () => {
  const m: StoredMessage = {
    id: "1",
    created_at: "2026-11-01T00:00:00Z",
    name: "Sam\r\nBcc: attacker@example.org",
    email: "sam@example.org\r\nBcc: attacker@example.org",
    topic: "station",
    message: "Line one.\nLine two, with more than ten characters.",
    user_id: null,
    page: "/stations/x\r\nX-Evil: 1",
  };
  const mail = composeMail(m, "help@example.test\r\nBcc: x@example.org", "no-reply@example.test");
  for (const v of [mail.from, mail.to, mail.replyTo, mail.subject]) assert.doesNotMatch(v, /[\r\n]/);
  assert.equal(mail.to, "help@example.test Bcc: x@example.org");
  assert.match(mail.replyTo, /sam@example\.org/);
  assert.match(mail.subject, /^\[OpenIoTwx support\] A station, building or flashing problem: Line one\. Line two/);
  // the body keeps the message's own line breaks, and the page is on one line
  assert.match(mail.text, /Line one\.\nLine two/);
  assert.doesNotMatch(mail.text.split("\n").find((l) => l.startsWith("Page:")) ?? "", /X-Evil: 1\n/);
  assert.match(mail.text, /Signed in: no/);
});

test("a long message is shortened in the subject only", () => {
  const long = "word ".repeat(40).trim();
  const mail = composeMail({ id: "1", created_at: "t", name: "A", email: "a@b.org", topic: "other", message: long, user_id: "u1", page: "" }, "h@e.org", "f@e.org");
  assert.ok(mail.subject.endsWith("…") && mail.subject.length < 130);
  assert.ok(mail.text.includes(long));
  assert.match(mail.text, /Signed in: yes \(user u1\)/);
  assert.match(mail.text, /Page: \(not given\)/);
});

test("the rate limiter allows a few, then waits, then forgives", () => {
  let t = 0;
  const limit = createRateLimiter([{ windowMs: 3600_000, max: 3 }, { windowMs: 86_400_000, max: 5 }], () => t);
  assert.equal(limit.check("a").ok, true);
  assert.equal(limit.check("a").ok, true);
  assert.equal(limit.check("a").ok, true);
  const blocked = limit.check("a");
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec > 3000 && blocked.retryAfterSec <= 3600);
  assert.equal(limit.check("b").ok, true, "another sender is not held back");
  t += 3600_000 + 1; // an hour later the first window has cleared
  assert.equal(limit.check("a").ok, true);
  assert.equal(limit.check("a").ok, true);
  const day = limit.check("a"); // five are now inside the day, so the daily cap holds although the hourly one has cleared
  assert.equal(day.ok, false);
  assert.ok(day.retryAfterSec > 20 * 3600, "and it says to wait most of a day");
  t += 86_400_000 + 1;
  assert.equal(limit.check("a").ok, true);
});

test("supportMailto builds a link", () => {
  assert.equal(supportMailto("help@example.test"), "mailto:help@example.test");
  assert.equal(supportMailto("help@example.test", "Re: A problem"), "mailto:help@example.test?subject=Re%3A%20A%20problem");
});
