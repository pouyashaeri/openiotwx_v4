/**
 * Better Auth keeps a signed copy of the session in a second cookie
 * (`session_data`) so reads can skip the database. Our auth route can only
 * deliver one Set-Cookie per response (see src/routes/api/auth/$.ts), so that
 * cookie is never refreshed: after someone signs in or up as a different person
 * in the same browser it would keep describing the PREVIOUS person for minutes.
 *
 * So the cache cookie is simply never read. Every session lookup goes through the
 * session token to the database, which always names the right person.
 */
const CACHE_COOKIES = ["__Host-grok-auth.session_data", "__Host-grok-auth.account_data"];

export function withoutSessionCache(headers: Headers): Headers {
  const cookie = headers.get("cookie");
  if (!cookie) return headers;
  const kept = cookie
    .split(";")
    .map((c) => c.trim())
    .filter((c) => c && !CACHE_COOKIES.some((name) => c.startsWith(`${name}=`)));
  const next = new Headers(headers);
  if (kept.length) next.set("cookie", kept.join("; "));
  else next.delete("cookie");
  return next;
}
