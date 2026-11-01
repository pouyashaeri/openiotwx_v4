import { LIMITS, SUPPORT_TOPICS, oneLine } from "./info.ts";

/** A support message as stored. */
export type StoredMessage = {
  id: string;
  created_at: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  user_id: string | null;
  page: string;
};

export const topicLabel = (id: string) => SUPPORT_TOPICS.find((t) => t.id === id)?.label ?? id;

/**
 * The email for one message: plain text. Every header value is one line (no CR or LF can be smuggled in
 * through the name, address or topic); only the body keeps the message's line breaks.
 */
export function composeMail(m: StoredMessage, to: string, from: string) {
  const name = oneLine(m.name, LIMITS.name);
  const email = oneLine(m.email, LIMITS.email);
  const topic = oneLine(topicLabel(m.topic), 80);
  const first = oneLine(m.message, 60);
  return {
    from: oneLine(from),
    to: oneLine(to),
    replyTo: `${name.replace(/[<>"]/g, "")} <${email}>`,
    subject: `[OpenIoTwx support] ${topic}: ${first}${m.message.length > 60 ? "…" : ""}`,
    text: [
      `From: ${name} <${email}>`,
      `Topic: ${topic}`,
      `Page: ${oneLine(m.page, LIMITS.page) || "(not given)"}`,
      `Signed in: ${m.user_id ? `yes (user ${m.user_id})` : "no"}`,
      `Received: ${m.created_at}`,
      "",
      m.message,
      "",
      "—",
      "Reply to this email to answer the sender. The message is also in the admin console, Support tab.",
    ].join("\n"),
  };
}
