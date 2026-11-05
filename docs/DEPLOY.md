# Deploying OpenIoTwx safely

On Kubernetes (NCAR CIRRUS)? Start with [CIRRUS.md](CIRRUS.md); this page is the security checklist it relies on.

This is the checklist for running the site on a real server (Docker, or Kubernetes such as NCAR CIRRUS). Development (`npm run dev`) keeps its conveniences; **production does not**. Production means `NODE_ENV=production`, which the Docker image sets.

## What the server insists on

In production the server refuses to run with an unsafe configuration. Every sign-in request fails with a clear message in the log, and `/api/health` returns 503 (so an orchestrator never marks the pod ready). It checks:

| Setting | Rule |
| --- | --- |
| `DATABASE_URL` | Required. A real Postgres (the embedded development database is not part of the production build). The database must be **UTF-8**. |
| `BETTER_AUTH_SECRET` | Required, at least 32 characters, not an example value. Signs every session. `openssl rand -base64 48` |
| `BETTER_AUTH_URL` | Required. The public address, for example `https://openiotwx.example.org`. Must be `https://` (plain `http://` only for localhost). It is the only origin allowed to sign in. |
| `VITE_AUTH_ENABLED` | Must not be `false`. |
| `CHORDS_ALLOW_PRIVATE` | Must not be `1` (it would let the importer reach private network addresses). |
| `HUB_TOKEN`, `INGEST_BRIDGE_TOKEN`, `GDEX_RELEASE_TOKEN` | If set, at least 24 characters. Leave unset to switch the matching route off. |

`POSTGRES_PASSWORD` that looks weak only produces a warning in the log.

## Making the first administrator

**Nobody becomes an administrator by being first, or by typing an email address.** In production:

- The first account to sign up is an ordinary user.
- `SUPERADMIN_EMAILS` and `ADMIN_EMAILS` are ignored (the log says so), because a sign-up with someone else's address cannot be told from the real person until email verification exists.

An administrator is made on purpose, by someone with access to the server:

1. The person signs up on the site, so the account exists.
2. Someone with access to the pod or the database runs:

   ```
   kubectl exec -it deploy/openiotwx -- node scripts/make-admin.mjs person@ucar.edu superadmin
   ```

   or, with the connection string: `DATABASE_URL=postgres://... node scripts/make-admin.mjs person@ucar.edu superadmin`

   or, in a database console (pgAdmin): `update profiles set role = 'superadmin' where lower(email) = lower('person@ucar.edu');`
3. The person signs in again (the command ends their open sessions so the new role applies at once).

`node scripts/make-admin.mjs --list` shows who has a role. Every change made with the command is written to the audit log. A super-admin can then make and remove ordinary administrators in the Admin panel. Super-admins are only made with the command.

## What is switched off

- **The Grok sign-in code.** The Google and X buttons went through a third-party broker, and the repository carried a client secret for it. The secret and the trust of `*.grok-sandbox.com` hosts are removed. The "gate identity" header (`x-grok-identity`) is ignored unless `GROK_GATE_ORIGIN` or `GROK_PROJECT_ID` is set, which it never is here. Sign-in is the site's own email and password.
- **Localhost origins.** In production only `BETTER_AUTH_URL` may sign in.
- **Raw error text on the open health route.** Errors go to the log.

## What is on

- **Security headers on every response** (pages, API, and static files such as the flasher): a Content-Security-Policy (no outside scripts, no eval, nothing may embed the site), HSTS, `nosniff`, `X-Frame-Options: DENY`, a referrer policy, and a permissions policy that allows only location and USB serial. They are set in `vite.config.ts` from `src/lib/security/headers.ts`.
- **Sign-in limits:** 10 sign-ins a minute and 20 sign-ups an hour per address, and 5 password changes per 10 minutes. Passwords are 10 to 128 characters.
- **Sessions:** `__Host-` cookies, `HttpOnly`, `Secure`, `SameSite=Lax`, seven days. Cross-site scripted requests are refused.
- **Station keys** are stored only as hashes and shown once. Token routes (`/api/ingest/bulk`, `/api/gdex/release`, the hub) compare in constant time and refuse when the token is unset.

## Database

- Postgres 14 or newer, **UTF-8** (a database created as WIN1252 fails at migration 0004).
- TimescaleDB is optional. If the extension is available the readings table becomes a hypertable with compression; otherwise it is an ordinary table.
- Apply migrations before the app starts: `node scripts/migrate.mjs` (the image has it; the compose file runs it as a one-shot job). Each file runs once and is recorded.
- Back it up (`pg_dump` on a schedule). The data is the readings.

## Behind a proxy or ingress

- Terminate HTTPS there. The app reads the visitor's address from `x-forwarded-for` for rate limits, so only put it behind a proxy that sets that header itself, and do not expose the app's port directly.
- Sign-in rate limits are kept in each replica's memory, so with several replicas the limit is per replica.
- Keep request bodies small (the compose file's Caddy caps `/api/*` at 1 MB).
- MQTT (`mosquitto`, port 1883) is optional and off unless the `mqtt` profile is on. Give it a password file (`deploy/mosquitto`) before exposing it.

## Chat and email

- The chat's language model and the support email are optional. Their keys (`ANTHROPIC_API_KEY`, `CHAT_LLM_KEY`, `SMTP_URL`) are read only on the server and never sent to the browser.

## Known limits

- **Email is not verified.** There is no verification email, so an address is not proof of identity. That is why administrators are made with the command and not by address.
- **better-auth advisory (GHSA-44jh-23m7-hpcf):** concurrent requests can exceed a rate limit when counters are stored in the database. This site keeps them in memory, so it is not affected. `npm audit` still lists it. Clearing it means moving to better-auth 1.7, which removed pieces the old Grok sign-in code uses, so that code has to be deleted first.
- **The CHORDS importer** refuses private addresses and re-checks every redirect, but it resolves the name before connecting. Run the app in a network that cannot reach internal services it should not.
- **Node.** Use Node 22 (the image does). Vite warns on Node 20.17.
