# OpenIoTwx platform: architecture

One repository, one `docker compose up`. A person chooses options in the wizard, gets a plan,
saves it to their account, registers the stations in that plan, and the stations start reporting
to a server that can scale from a classroom to a regional network.

```
 Station firmware ──HTTPS POST /api/ingest (x-api-key)──┐
 Station firmware ──MQTT (QoS 1)── Mosquitto ── bridge ─┤   (optional profile)
                                                        ▼
 Browser ─────────────► Caddy (TLS, least-conn LB) ──► app × N   (stateless web + API)
                                                        │  validate · rate-limit · buffer
                                                        ▼
                                              PostgreSQL + TimescaleDB
                              measurements (hypertable) · hourly rollup · compression · accounts
```

## What the user sees

| Step | Where | What happens |
|---|---|---|
| Choose options | `/wizard` | Existing needs-first wizard → recommendation (config A–D, sensors, checklist). |
| Get a plan | `/plan` | Existing plan page, plus **Make it real**: sign in, save the plan, register _N_ stations. |
| Bring stations online | `/plan`, `/account` | Each station gets an API key (shown once), a `config.json` and a `curl` test line. |
| See data | `/stations/:slug` | Latest values, chart (6 h … 1 y), CSV export, public/private switch. |
| Come back anywhere | `/login`, `/account` | Plans and stations are restored from the database on any device. |
| Bring data in | `/chords` | Pick any CHORDS portal and instrument; it becomes one of your stations and stays in sync. |
| Run the network | `/admin/login` (not linked anywhere) | Staff only: overview, every station, every user (suspend, reset password, sign out everywhere, delete, promote), ingest health. |

## Components

**Web + API (`app`).** TanStack Start (Node). Stateless, so run as many replicas as you need
(`APP_REPLICAS`, or `docker compose up -d --scale app=8`). All user actions are server functions
behind middleware: `authMiddleware` (verified session) → `appUserMiddleware` (profile, suspended
check) → `adminMiddleware` (role). Every query is scoped by the verified user id, never a
client-sent one.

**Accounts and roles.** Better Auth with email + password, stored in the same Postgres. Three levels live in `profiles`:

| | user | admin | super-admin |
|---|---|---|---|
| Own plans and stations | yes | yes | yes |
| Admin console | no (it looks like a missing page) | yes | yes |
| Suspend, reset password, sign out, delete **users** | no | yes | yes |
| Manage **admins**, promote/demote | no | no | yes |

Staff sign in on their own page, `/admin/login`, which is not linked from the site and is kept out of search engines; a correct password for a non-staff account is refused like a wrong one. Super-admins come from `SUPERADMIN_EMAILS`, admins from `ADMIN_EMAILS` (or are promoted in the console); if both are empty the first account becomes the super-admin. Everything staff do is written to `audit_log`.

**Ingest (`src/lib/platform/ingest.server.ts`).** This is the hot path and it is built so the
database is not in the request path:

1. Authenticate the key: SHA-256 → in-memory cache (30 s; bad keys cached 5 s so key-guessing does not hit the DB).
2. Token-bucket rate limit per station (`rate_limit_per_min`, adjustable per station by an admin).
3. Validate and normalise (≤ 500 readings and ≤ 2000 values per request, sane timestamps, numeric values, metric names `[a-z][a-z0-9_]{0,39}`).
4. Append to an in-memory buffer and answer `202`.
5. A flusher writes up to thousands of rows per statement with `unnest(...)` and
   `ON CONFLICT DO NOTHING`, then updates each station's `last_values` once per batch.

Overload behaviour is explicit rather than accidental: a full buffer answers `503` with
`Retry-After` (backpressure), an over-quota station gets `429`. Because inserts are idempotent
(unique `(station_id, metric, time)`), station retries are safe. `SIGTERM` flushes the buffer
before exit (`stop_grace_period: 15s`). The trade-off to know about: a hard crash can lose
the unflushed buffer (≤ about one second of readings per replica). For stations that need
stronger guarantees use MQTT, which acknowledges only after the app accepted the batch.

**Storage.** One narrow table, `measurements(time, station_id, metric, value)`, so any sensor works
without a schema change. On TimescaleDB (the Docker image) the migration turns it into a hypertable
partitioned by day and by station, compresses chunks older than 7 days, and maintains an hourly
continuous aggregate (`measurements_hourly`) that long-range charts read. On plain Postgres or the
embedded dev database the same name is a plain view, so the application code does not change. Add a
retention policy (`select add_retention_policy('measurements', interval '2 years')`) when you want one.

**MQTT (optional, `--profile mqtt`).** Mosquitto with ACLs (stations may only write; only the bridge
may read, so keys on the bus cannot be read by other stations). `scripts/mqtt-bridge.mjs` batches
messages to `/api/ingest/bulk` and acknowledges the broker after the app accepts them. Several bridges
can run side by side (shared subscription).

## CHORDS compatibility

The platform speaks CHORDS in both directions, so devices and tools that already know CHORDS work with it.

**Same addresses, ours underneath**

| CHORDS address | Here |
|---|---|
| `/measurements/url_create?instrument_id=N&t1=22&rh1=40&at=…&api_key=…` | Upload. `instrument_id` is the number shown on the station page; `api_key` is the station key; `test` validates without storing. |
| `/instruments.json`, `/sites.json`, `/vars.json` | Listings of stations that chose to share. |
| `/instruments/N.csv`, `.json`, `.geojson` (`?start=&end=`) and `/api/v1/data/N.…` | Downloads. Public stations need no key; private ones need the owner signed in or the station key as `api_key`. CSV is GeoCSV. |

**Parameters.** A shared catalog of variables (air temperature, relative humidity, soil moisture, CO₂, PM, wind, …) ships built in; anyone can add one (`leaf_wetness`) and it is then available to every station. Each station ticks the variables it reports, and can switch on "only accept the ticked variables" so anything else a device sends is rejected. Without that switch any well-formed variable name is accepted and stored.

**Importing from another portal.** `/chords` lists the instruments of any CHORDS portal (the listing endpoints are public). Importing one creates a normal station here: the last 30 days first, then a pull every 15 minutes (claimed atomically so replicas never pull the same station twice). Portals that protect downloads need the email and API key their owner issued; the key is stored encrypted (AES-GCM, derived from `BETTER_AUTH_SECRET`) and never sent back to the browser. Because the address comes from a user, the server only fetches public internet addresses (loopback, private ranges and cloud metadata are refused; `CHORDS_ALLOW_PRIVATE=1` relaxes this for a portal on your own network).

**What was and was not verified against real CHORDS.** The listing endpoints were checked against the live IoTWx, 3D-PAWS and SugarTech portals (the 78 instruments on IoTWx load and can be picked). Downloading measurements from those portals needs credentials we do not have, so the CSV and JSON readers follow the CHORDS documentation and are written to be tolerant (GeoCSV, nested or flat JSON, GeoJSON). They are tested on samples and by importing this platform's own output. The first import from a real portal with a key is the check still to do.

## The community hub (v3's pages)

v3 shipped as a website plus a separate community server (FastAPI, its own database, no sign-in). Here the website's Plan, Analysis, Forecast and Community pages are merged into this app, and that server is rebuilt inside it: **the hub**, served at `/hub` from the same Postgres as accounts and stations. The pages ask it for the same routes v3 used (`/hub/api/stations/`, `/readings/…`, `/credit-forecast/…`, `/forecast-runs/`, `/collective/…`, `/consent/`), so they work without any extra setup.

| Data | Where it comes from | Who can read | Who can write |
|---|---|---|---|
| Stations and readings | our stations and measurements, translated to v3's names (hourly: rain adds up, the rest average) | public stations, plus your own | nobody here; stations use the ingest API |
| Forecast runs | `forecast_runs` | you (your own), staff (all) | signed-in people request; the runner updates with `HUB_TOKEN` |
| Forecast values | `credit_forecasts` | anyone who can see the station | the runner, with `HUB_TOKEN` |
| Print queue | `collective_inventory` (rows belong to the account that saved them) | everyone | signed-in people, their own rows |
| Offers board | `collective_members` | everyone, **without contact details** | signed-in people |
| Sharing decisions | `data_consent` (the record behind the GDEX switch) | you, and staff | signed-in people |

The hub never runs a model. A forecast request waits in the queue until a runner picks it up. The runner is v3's `credit_runner` from `infra/`: give it `API_URL=https://<site>/hub` and the same `HUB_TOKEN` as the site and it works the queue (`/compute/status` shows whether one has reported in the last six hours). The place loader attaches the same way. v3's Metabase and MQTT listener expect v3's own tables, so they stay with the standalone stack. If you would rather use the whole standalone stack, point the pages at it under "Where the page looks for your services".

What the pages fetch straight from the public services, from the browser: the CDC/ATSDR Social Vulnerability Index (ArcGIS), place name lookup (OpenStreetMap Nominatim), and EJScreen (the EJAM API, falling back to the hub, which proxies it with a small rate limit).

## Scaling levers

| Pressure | Lever |
|---|---|
| More requests | `--scale app=N`. Replicas are stateless; Caddy balances by least connections and removes unhealthy ones. |
| More rows | Batch size and flush interval (`INGEST_BATCH_ROWS`, `INGEST_FLUSH_MS`), Postgres size, then Timescale multi-node or a read replica for dashboards. |
| Long history | Compression (on), rollups (on), retention (opt in). Charts over 48 h read the hourly rollup. |
| Bursts | Buffer (`INGEST_MAX_BUFFER`) absorbs; beyond it stations get `503 Retry-After`. |
| Abusive station | Per-station rate limit, disable from `/admin`, rotate key. |

Measured on a laptop with the **embedded** single-threaded dev database (the weakest possible
backend): ~1,500 requests/s, ~43,000 values/s accepted at p95 73 ms, with `503` backpressure
engaging when the database was the bottleneck and no accepted data lost. Run it yourself with
`DATABASE_URL=… npm run loadtest -- --url http://localhost --stations 500 --seconds 30`.
Numbers on TimescaleDB depend on hardware; measure before promising a figure.

## Security notes

- Station keys are random 192-bit values, stored only as SHA-256; shown once; rotate any time.
- Sessions use `__Host-` cookies (HTTPS required outside `localhost`; Caddy provides TLS for a real domain).
- Station pages are private by default; the owner chooses to share. Admins can see everything.
- The MQTT bridge endpoint is closed unless `INGEST_BRIDGE_TOKEN` is set, and compares it in constant time.
- Owners cannot change status, rate limit or ownership of a station; the server ignores those fields unless the caller is an admin.

## Known limits (first version)

- Rate-limit buckets and key caches are per replica, so the effective limit is `limit × replicas`.
- The Docker stack and the TimescaleDB migration branch were written but not run in the environment
  that built them (no Docker daemon); the same code was verified end to end on the production build
  against a real Postgres wire connection. Run `docker compose up --build` and `npm run e2e` against it once.
- No email verification or password reset yet (needs an email provider).
- Better Auth's session-data cookie cache is dropped at the API route because the Start dev server forwards only one `Set-Cookie`; sessions resolve from the database instead.
