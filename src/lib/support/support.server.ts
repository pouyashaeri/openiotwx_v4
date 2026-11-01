/**
 * Contact and support (server-only).
 *
 * A message from /contact is always saved first, so it is never lost if email is down. Then it is emailed to
 * the support address with the sender as Reply-To. The address comes from the admin console (kept in the
 * database) or, failing that, SUPPORT_EMAIL. Nothing here invents an address: with none set, the site shows
 * none and the form still works, with admins reading the messages in the console.
 */
import { createHash, randomBytes } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import nodemailer from "nodemailer";
import { getSql } from "@/lib/db";
import { audit } from "@/lib/platform/service.server";
import { LIMITS, createRateLimiter, oneLine, validateSupport, type SupportInput } from "./info";
import { composeMail, type StoredMessage } from "./mail";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SETTINGS_KEY = "support_email";

export type SupportAddress = { email: string | null; source: "admin" | "env" | null };

/** The address messages go to, and where it came from. The admin setting wins over the environment. */
export async function getSupportAddress(): Promise<SupportAddress> {
  try {
    const sql = await getSql();
    const rows = await sql<{ value: unknown }>`select value from site_settings where key = ${SETTINGS_KEY}`;
    const v = rows[0]?.value;
    if (typeof v === "string" && EMAIL.test(v)) return { email: v, source: "admin" };
  } catch {
    // Before the migration has run there is no table; fall back to the environment.
  }
  const env = (process.env.SUPPORT_EMAIL ?? "").trim();
  return EMAIL.test(env) ? { email: env, source: "env" } : { email: null, source: null };
}

/** An empty address clears the admin setting, so the environment value (if any) applies again. */
export async function saveSupportEmail(actorId: string, email: string): Promise<SupportAddress> {
  const value = email.trim();
  if (value && (!EMAIL.test(value) || value.length > LIMITS.email)) throw new Error("That email address doesn't look right.");
  const sql = await getSql();
  if (!value) await sql`delete from site_settings where key = ${SETTINGS_KEY}`;
  else
    await sql`insert into site_settings (key, value, updated_at) values (${SETTINGS_KEY}, ${JSON.stringify(value)}::jsonb, now())
              on conflict (key) do update set value = excluded.value, updated_at = now()`;
  await audit(actorId, "support.email", null, { cleared: !value });
  return getSupportAddress();
}

// ── Email ───────────────────────────────────────────────────────────────────

type SmtpOptions = Parameters<typeof nodemailer.createTransport>[0];

function smtpOptions(): SmtpOptions | null {
  const url = (process.env.SMTP_URL ?? "").trim();
  const timeouts = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };
  if (url) return { url, ...timeouts } as unknown as SmtpOptions;
  const host = (process.env.SMTP_HOST ?? "").trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = (process.env.SMTP_USER ?? "").trim();
  return {
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true" : port === 465,
    ...(user ? { auth: { user, pass: process.env.SMTP_PASS ?? "" } } : {}),
    ...timeouts,
  } as unknown as SmtpOptions;
}

function fromAddress(): string {
  const set = (process.env.SUPPORT_FROM ?? "").trim();
  if (set) return set;
  const user = (process.env.SMTP_USER ?? "").trim();
  if (EMAIL.test(user)) return user;
  try {
    return `no-reply@${new URL(process.env.BETTER_AUTH_URL ?? "http://localhost").hostname}`;
  } catch {
    return "no-reply@localhost";
  }
}

/** Try to email a stored message. Never throws: the result says whether it was sent. */
async function sendMail(m: StoredMessage): Promise<{ ok: boolean; error: string }> {
  const to = (await getSupportAddress()).email;
  if (!to) return { ok: false, error: "No support email address is set." };
  const options = smtpOptions();
  if (!options) return { ok: false, error: "SMTP is not configured (set SMTP_URL or SMTP_HOST)." };
  try {
    const transport = nodemailer.createTransport(options);
    await transport.sendMail(composeMail(m, to, fromAddress()));
    transport.close();
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

// ── Sending a message ───────────────────────────────────────────────────────

// Per address: a few an hour and a modest number a day. It is per server process, which is enough to stop a script.
const limiter = createRateLimiter([
  { windowMs: 3600_000, max: 5 },
  { windowMs: 86_400_000, max: 20 },
]);
const SALT = process.env.BETTER_AUTH_SECRET || randomBytes(16).toString("hex");

const hashAddress = (ip: string) => createHash("sha256").update(`${SALT}:support:${ip}`).digest("hex").slice(0, 24);

function clientAddress(): string {
  try {
    const h = getRequest().headers;
    return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  } catch {
    return "unknown";
  }
}

export type SendInput = SupportInput & { page?: string; website?: string };

export async function submitMessage(input: SendInput, userId: string | null): Promise<{ ok: true; emailed: boolean; dropped?: true }> {
  // The hidden "website" field is for robots. A person never fills it in; pretend it worked and keep nothing.
  if ((input.website ?? "").trim() !== "") return { ok: true, emailed: false, dropped: true };

  const invalid = validateSupport(input);
  if (invalid) throw new Error(invalid.message);

  const ipHash = hashAddress(clientAddress());
  const gate = limiter.check(ipHash);
  if (!gate.ok) {
    const address = (await getSupportAddress()).email;
    throw new Error(`That is a lot of messages in a short time. Please try again in ${Math.max(1, Math.ceil(gate.retryAfterSec / 60))} minutes${address ? `, or email us at ${address}` : ""}.`);
  }

  const sql = await getSql();
  const rows = await sql.query<StoredMessage>(
    `insert into support_messages (name, email, topic, message, user_id, ip_hash, page)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, created_at, name, email, topic, message, user_id, page`,
    [oneLine(input.name, LIMITS.name), oneLine(input.email, LIMITS.email), input.topic, input.message.trim(), userId, ipHash, oneLine(input.page ?? "", LIMITS.page)],
  );
  const stored = rows[0];
  const sent = await sendMail(stored);
  await sql.query("update support_messages set emailed = $2, email_error = $3 where id = $1", [stored.id, sent.ok, sent.error]);
  if (!sent.ok) console.warn("[support] message saved but not emailed:", sent.error);
  return { ok: true, emailed: sent.ok };
}

// ── The admin inbox ─────────────────────────────────────────────────────────

export type InboxRow = StoredMessage & { status: "new" | "handled"; emailed: boolean; email_error: string };

export async function listMessages(limit = 300) {
  const sql = await getSql();
  const rows = await sql.query<InboxRow>(
    `select id, created_at, name, email, topic, message, user_id, page, status, emailed, email_error
     from support_messages order by created_at desc limit $1`,
    [limit],
  );
  const [{ n }] = await sql.query<{ n: string }>("select count(*)::text as n from support_messages where status = 'new'");
  return { messages: rows, newCount: Number(n), address: await getSupportAddress(), smtp: smtpOptions() !== null };
}

export async function setStatus(actorId: string, id: string, status: "new" | "handled") {
  const sql = await getSql();
  await sql.query("update support_messages set status = $2 where id = $1", [id, status]);
  await audit(actorId, "support.status", id, { status });
}

export async function deleteMessage(actorId: string, id: string) {
  const sql = await getSql();
  await sql.query("delete from support_messages where id = $1", [id]);
  await audit(actorId, "support.delete", id, {});
}
