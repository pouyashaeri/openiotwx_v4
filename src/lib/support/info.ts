/** Client-safe pieces of the support system: no database, no network. */

export const SUPPORT_PATH = "/contact";

export const SUPPORT_TOPICS = [
  { id: "planning", label: "Planning a station" },
  { id: "station", label: "A station, building or flashing problem" },
  { id: "data", label: "Data, the map or GDEX" },
  { id: "account", label: "My account" },
  { id: "other", label: "Something else" },
] as const;

export type SupportTopic = (typeof SUPPORT_TOPICS)[number]["id"];

export const TOPIC_IDS: readonly string[] = SUPPORT_TOPICS.map((t) => t.id);

export const LIMITS = { name: 100, email: 200, messageMin: 10, messageMax: 4000, page: 300 } as const;

/** A mailto: link for the support address, with an optional subject. */
export function supportMailto(email: string, subject?: string): string {
  return `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
}

export type SupportInput = { name: string; email: string; topic: string; message: string };

/** The messages the form shows, in the site's own words. Returns null when everything is fine. */
export function validateSupport(input: SupportInput): { field: keyof SupportInput; message: string } | null {
  const name = input.name.trim();
  const email = input.email.trim();
  const message = input.message.trim();
  if (!name) return { field: "name", message: "Tell us your name." };
  if (name.length > LIMITS.name) return { field: "name", message: `That name is too long. Use ${LIMITS.name} characters or fewer.` };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > LIMITS.email) return { field: "email", message: "That email address doesn't look right." };
  if (!TOPIC_IDS.includes(input.topic)) return { field: "topic", message: "Pick what this is about." };
  if (message.length < LIMITS.messageMin) return { field: "message", message: `Tell us a little more. A few words (at least ${LIMITS.messageMin} characters) help us answer.` };
  if (message.length > LIMITS.messageMax) return { field: "message", message: `That message is too long. Keep it under ${LIMITS.messageMax} characters.` };
  return null;
}

/** For headers: a single line, no control characters. Stops one field from smuggling in another header. */
// Control characters, plus the Unicode line and paragraph separators, built from codes so the source stays plain ASCII.
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`, "g");
export function oneLine(value: string, max = 200): string {
  return value.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** A sliding-window limit per key. `check` records a hit and says whether it is allowed. */
export function createRateLimiter(rules: { windowMs: number; max: number }[], now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string): { ok: boolean; retryAfterSec: number } {
      const t = now();
      const longest = Math.max(...rules.map((r) => r.windowMs));
      const list = (hits.get(key) ?? []).filter((x) => t - x < longest);
      for (const r of rules) {
        const inside = list.filter((x) => t - x < r.windowMs);
        if (inside.length >= r.max) {
          hits.set(key, list);
          return { ok: false, retryAfterSec: Math.ceil((inside[0] + r.windowMs - t) / 1000) };
        }
      }
      list.push(t);
      hits.set(key, list);
      if (hits.size > 5000) for (const [k, v] of hits) if (v.every((x) => t - x >= longest)) hits.delete(k);
      return { ok: true, retryAfterSec: 0 };
    },
  };
}
