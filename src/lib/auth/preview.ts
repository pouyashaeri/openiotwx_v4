/**
 * What used to be the Grok live-preview OAuth client: a shared client id, a client SECRET written into the
 * source, and a trust list for *.grok-sandbox.com hosts.
 *
 * It is gone on purpose. A secret in a repository is public the moment the repository is, and trusting other
 * people's preview hosts has no place on a server that NCAR runs. Everything is kept as an empty value so the
 * code that imports it still compiles; nothing here can sign anyone in. Sign-in is the site's own email and
 * password (src/lib/auth/server.ts). To federate with an identity broker again, set GROK_AUTH_CLIENT_ID and
 * GROK_AUTH_CLIENT_SECRET in the environment and list the providers in providers.ts.
 */
export const PREVIEW_CLIENT_ID = "";
export const PREVIEW_CLIENT_SECRET = "";

/** The broker address, used only when a broker is configured through the environment. */
export const GROK_ISSUER_DEFAULT = "https://auth.grok.me";

/** Hosts whose callbacks a preview client would accept. None. */
export const PREVIEW_ALLOWED_HOSTS: readonly string[] = [];
