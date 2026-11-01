#!/usr/bin/env node
/**
 * The contact and support system, end to end in a real browser. Run against a FRESH server (the first
 * account becomes the super-admin). There are two modes, each needing the server started a little differently.
 *
 * 1. With email (default). The script starts a tiny SMTP server of its own (the "sink") and the app is pointed at it:
 *
 *      SUPPORT_EMAIL=help@example.test SMTP_URL=smtp://127.0.0.1:2525 npm run dev -- --port 8093
 *      SMTP_PORT=2525 node scripts/e2e-support.mjs http://localhost:8093
 *
 *    It checks what the sink receives (recipient, Reply-To, subject, body), the form's own error messages, the
 *    robot trap, the rate limit, the admin inbox, the address override, and a phone-width layout.
 *
 * 2. Without email (--no-smtp). Start the server with neither SUPPORT_EMAIL nor SMTP_URL:
 *
 *      npm run dev -- --port 8093
 *      node scripts/e2e-support.mjs http://localhost:8093 --no-smtp
 *
 *    It checks that no address is shown, that a message is still saved and the visitor still sees success,
 *    that the admin inbox says it was not emailed, and that an address set in the console is then shown.
 */
import { createServer } from "node:net";
import { chromium } from "playwright";

const noSmtp = process.argv.includes("--no-smtp");
const base = process.argv.find((a, i) => i >= 2 && /^https?:/.test(a)) ?? "http://localhost:8093";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 2525);
const SUPPORT = "help@example.test";
const stamp = Date.now();
const PASSWORD = "correct-horse-battery";
let failed = false;
const ok = (m) => console.log("ok  ", m);
const bad = (m) => {
  failed = true;
  console.error("FAIL:", m);
};
const expect = (c, m) => (c ? ok(m) : bad(m));

// ── A tiny SMTP server that keeps what it is sent ───────────────────────────
const mails = [];
function startSink() {
  const server = createServer((socket) => {
    let mode = "cmd";
    let buf = "";
    let mail = { from: "", rcpt: [], raw: "" };
    const say = (s) => socket.write(`${s}\r\n`);
    say("220 sink ESMTP ready");
    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      for (;;) {
        if (mode === "data") {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) return;
          mail.raw = buf.slice(0, end);
          buf = buf.slice(end + 5);
          mails.push(mail);
          mail = { from: "", rcpt: [], raw: "" };
          mode = "cmd";
          say("250 2.0.0 queued");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") say("250-sink\r\n250 8BITMIME");
        else if (cmd === "MAIL") {
          mail.from = line.slice(10);
          say("250 OK");
        }
        else if (cmd === "RCPT") {
          mail.rcpt.push(line.slice(8));
          say("250 OK");
        }
        else if (cmd === "DATA") {
          mode = "data";
          say("354 end with <CRLF>.<CRLF>");
        }
        else if (cmd === "RSET") say("250 OK");
        else if (cmd === "NOOP") say("250 OK");
        else if (cmd === "QUIT") {
          say("221 bye");
          socket.end();
        }
        else say("502 not supported");
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(SMTP_PORT, "127.0.0.1", () => resolve(server));
  });
}

/** RFC 2047 encoded words (=?UTF-8?Q?...?= or ?B?...?=), joined, as a mail reader shows them. */
function decodeWords(value) {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_m, kind, text) =>
      kind.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_x, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8"),
    );
}

/** Headers and decoded body of a captured message. */
function parseMail(raw) {
  const split = raw.indexOf("\r\n\r\n");
  const head = raw.slice(0, split).replace(/\r\n[ \t]+/g, " ");
  const headers = {};
  for (const line of head.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  let body = raw.slice(split + 4);
  const enc = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (enc === "base64") body = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  else if (enc === "quoted-printable") {
    const bytes = [];
    const t = body.replace(/=\r\n/g, "");
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "=" && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) {
        bytes.push(parseInt(t.slice(i + 1, i + 3), 16));
        i += 2;
      }
      else bytes.push(t.charCodeAt(i));
    }
    body = Buffer.from(bytes).toString("utf8");
  }
  for (const k of Object.keys(headers)) headers[k] = decodeWords(headers[k]);
  return { headers, body: body.replace(/\r\n/g, "\n") };
}

const waitFor = async (cond, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const errors = [];
const watch = (page) => page.on("pageerror", (e) => !/ViewTransition|Transition was aborted/.test(e.message) && errors.push(e.message));
let sink = null;

try {
  if (!noSmtp) sink = await startSink();

  // 1. A visitor, signed out, on the contact page.
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await anon.newPage();
  watch(page);
  await page.goto(`${base}/contact`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Contact and support" }).waitFor();
  if (noSmtp) {
    expect((await page.getByRole("link", { name: /@/ }).count()) === 0, "with no address set, no address is shown");
  } else {
    const mailLink = page.getByRole("link", { name: SUPPORT });
    await mailLink.first().waitFor({ timeout: 15000 });
    expect((await mailLink.first().getAttribute("href")) === `mailto:${SUPPORT}`, `the support address is shown with a mailto link (${SUPPORT})`);
  }

  // The form answers in the site's own words and sends nothing until it is right.
  const send = page.getByRole("button", { name: "Send message" });
  await send.click();
  await page.getByText("Tell us your name.").waitFor();
  ok("an empty form says what is missing (no browser pop-up)");
  await page.getByLabel("Your name").fill("Pat Visitor");
  await send.click();
  await page.getByText("That email address doesn't look right.").waitFor();
  await page.getByLabel("Your email").fill("pat@example.org");
  await send.click();
  await page.getByText("Pick what this is about.").waitFor();
  await page.getByLabel("What is it about?").selectOption("station");
  await page.getByLabel("Your message").fill("help");
  await send.click();
  await page.getByText(/Tell us a little more/).waitFor();
  ok("a too-short message is refused with the site's own wording");
  if (sink) expect(mails.length === 0, "nothing was sent while the form was incomplete");

  // A real message.
  await page.getByLabel("Your message").fill("My station stopped reporting last night.\nThe light on the board is blinking.");
  await send.click();
  await page.getByRole("heading", { name: "Thanks, we got it." }).waitFor({ timeout: 20000 });
  expect(await page.getByText("pat@example.org").first().isVisible(), "the visitor sees success, and where the reply goes");

  if (sink) {
    expect(await waitFor(() => mails.length >= 1), "the support email arrived at the SMTP server");
    const m = mails[0];
    const { headers, body } = parseMail(m.raw);
    expect(m.rcpt.some((r) => r.toLowerCase().includes(SUPPORT)), `it was addressed to ${SUPPORT} (${m.rcpt.join(" ")})`);
    expect((headers["reply-to"] ?? "").includes("pat@example.org"), `Reply-To is the sender (${headers["reply-to"]})`);
    expect((headers["to"] ?? "").includes(SUPPORT), "the To header is the support address");
    expect((headers["subject"] ?? "").startsWith("[OpenIoTwx support] A station, building or flashing problem:"), `the subject names the topic (${headers["subject"]})`);
    expect(body.includes("My station stopped reporting last night.\nThe light on the board is blinking."), "the body has the message with its line breaks");
    expect(body.includes("Pat Visitor") && body.includes("pat@example.org"), "the body names the sender");
    expect(/^Page: /m.test(body) && /Signed in: no/.test(body), "the body says which page and that the sender was signed out");
  }

  // 2. The robot trap: a hidden field that only a script fills in. It looks like it worked and keeps nothing.
  const before = mails.length;
  await page.getByRole("button", { name: "Send another message" }).click();
  await page.getByLabel("Your message").fill("This message is from a robot, and should be dropped.");
  await page.locator('input[name="website"]').fill("http://spam.example", { force: true });
  await send.click();
  await page.getByRole("heading", { name: "Thanks, we got it." }).waitFor({ timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  if (sink) expect(mails.length === before, "a message with the hidden field filled in is dropped (no email)");

  // 3. The phone layout.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ph = await phone.newPage();
  await ph.goto(`${base}/contact`, { waitUntil: "networkidle" });
  await ph.getByRole("heading", { name: "Contact and support" }).waitFor();
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow <= 1, `no horizontal overflow on a phone (${overflow}px)`);
  await ph.screenshot({ path: "screenshots/contact-phone.png", fullPage: true });
  await page.screenshot({ path: "screenshots/contact.png", fullPage: true });
  await phone.close();

  // 4. The admin inbox (the first account on a fresh server is the super-admin).
  const owner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adm = await owner.newPage();
  watch(adm);
  const email = `support-${stamp}@example.com`;
  await adm.goto(`${base}/login?next=/contact`, { waitUntil: "networkidle" });
  await adm.getByRole("button", { name: /create an account/i }).click();
  await adm.getByLabel("Name").fill("Admin Alex");
  await adm.getByLabel("Email").fill(email);
  await adm.getByLabel("Password").fill(PASSWORD);
  await adm.getByRole("button", { name: /^create account$/i }).click();
  await adm.waitForURL((u) => u.pathname === "/contact");
  let prefilled = false;
  for (let i = 0; i < 40 && !prefilled; i++) {
    prefilled = (await adm.getByLabel("Your name").inputValue()) === "Admin Alex" && (await adm.getByLabel("Your email").inputValue()) === email;
    if (!prefilled) await adm.waitForTimeout(250);
  }
  expect(prefilled, "signed in, the form already has the person's name and email");

  await adm.goto(`${base}/admin/login`, { waitUntil: "networkidle" });
  await adm.getByLabel("Email").fill(email);
  await adm.getByLabel("Password").fill(PASSWORD);
  await adm.getByRole("button", { name: "Sign in" }).click();
  await adm.getByRole("heading", { name: "Network operations" }).waitFor({ timeout: 15000 });
  await adm.getByRole("tab", { name: "support" }).click();
  await adm.getByRole("heading", { name: /Messages/ }).waitFor({ timeout: 15000 });
  const card = adm.locator("li", { hasText: "Pat Visitor" });
  await card.first().waitFor({ timeout: 15000 });
  expect(await card.first().getByText("My station stopped reporting last night.").isVisible(), "the admin inbox lists the visitor's message");
  expect((await card.first().getByRole("link", { name: "pat@example.org" }).getAttribute("href"))?.startsWith("mailto:pat@example.org"), "with a mailto link to the sender");
  expect(await adm.getByText("1 new").first().isVisible(), "and counts it as new");
  if (noSmtp) expect(await card.first().getByText(/not emailed/).isVisible(), "it says the message was saved but not emailed");
  else expect(await card.first().getByText(/ · emailed$/).isVisible(), "it says the message was emailed");
  expect((await adm.locator("li", { hasText: "robot" }).count()) === 0, "the robot's message is not in the inbox");
  await adm.screenshot({ path: "screenshots/support-admin.png", fullPage: true });

  await card.first().getByRole("button", { name: "Mark handled" }).click();
  await card.first().getByRole("button", { name: "Reopen" }).waitFor({ timeout: 10000 });
  await adm.getByText("0 new").first().waitFor({ timeout: 10000 });
  ok("Mark handled moves it out of the new count, and it can be reopened");

  // The address: where it comes from, and the admin's own setting taking over, then clearing it again.
  const field = adm.getByLabel("Address", { exact: true });
  if (noSmtp) expect(await adm.getByText(/No address is set/).first().isVisible(), "the console says no address is set");
  else expect(await adm.getByText(/from SUPPORT_EMAIL on the server/).first().isVisible(), "the console shows the address comes from SUPPORT_EMAIL");
  await field.fill("desk@example.test");
  await adm.getByRole("button", { name: "Save", exact: true }).click();
  await adm.getByText(/Active: desk@example\.test \(set here\)/).waitFor({ timeout: 10000 });
  await page.goto(`${base}/contact`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "desk@example.test" }).first().waitFor({ timeout: 15000 });
  ok("an address set in the console shows on the public contact page");
  await field.fill("not an address");
  await adm.getByRole("button", { name: "Save", exact: true }).click();
  await adm.getByText("That email address doesn't look right.").first().waitFor({ timeout: 10000 }).catch(() => {});
  await field.fill("");
  await adm.getByRole("button", { name: "Save", exact: true }).click();
  await adm.getByText("Cleared", { exact: true }).waitFor({ timeout: 10000 });
  if (!noSmtp) await adm.getByText(/from SUPPORT_EMAIL on the server/).first().waitFor({ timeout: 10000 });
  ok("clearing the console address hands back to the environment setting (or none)");

  // The message can be deleted, with a themed confirmation.
  adm.on("dialog", () => bad("a native browser dialog appeared"));
  await card.first().getByRole("button", { name: "Delete" }).click();
  await adm.getByRole("dialog").getByRole("button", { name: "Delete message" }).click();
  await adm.getByText("Deleted", { exact: true }).waitFor({ timeout: 10000 });
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    gone = (await adm.locator("li", { hasText: "Pat Visitor" }).count()) === 0;
    if (!gone) await adm.waitForTimeout(250);
  }
  expect(gone, "a message can be deleted after a themed confirmation");

  // 5. The rate limit: after a few messages from one address, a friendly pause (and it is not an error page).
  if (!noSmtp) {
    await page.goto(`${base}/contact`, { waitUntil: "networkidle" });
    let blocked = false;
    let sent = 1; // the first real message above
    for (let i = 0; i < 8 && !blocked; i++) {
      await page.getByLabel("Your name").fill("Pat Visitor");
      await page.getByLabel("Your email").fill("pat@example.org");
      await page.getByLabel("What is it about?").selectOption("other");
      await page.getByLabel("Your message").fill(`Another message number ${i + 1}, long enough to be accepted.`);
      await page.getByRole("button", { name: "Send message" }).click();
      const done = page.getByRole("heading", { name: "Thanks, we got it." });
      const warn = page.getByText(/That is a lot of messages in a short time/).first(); // shown inline and as a toast
      await Promise.race([done.waitFor({ timeout: 20000 }), warn.waitFor({ timeout: 20000 })]).catch(() => {});
      if (await warn.isVisible().catch(() => false)) blocked = true;
      else {
        sent++;
        await page.getByRole("button", { name: "Send another message" }).click();
      }
    }
    expect(blocked && sent === 5, `the sixth message in an hour is held back politely (sent ${sent} before the pause)`);
    await new Promise((r) => setTimeout(r, 1500));
    expect(mails.length === 5, `exactly five emails reached the SMTP server (${mails.length})`);
  }

  if (errors.length) bad(`browser errors: ${errors.slice(0, 4).join(" | ")}`);
} catch (e) {
  bad(e.message);
} finally {
  await browser.close();
  sink?.close();
}
console.log(failed ? "SUPPORT E2E FAILED" : `Support E2E passed${noSmtp ? " (no SMTP)" : ""}`);
process.exitCode = failed ? 1 : 0;
