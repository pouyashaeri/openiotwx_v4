# OpenIoTwx

Plan a weather station with the wizard, save the plan to an account, register the stations, and
collect their data on a server you run. Design notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What replaced the legacy mesonet services: [docs/LEGACY-MAPPING.md](docs/LEGACY-MAPPING.md).

## What is in it

- **Plan:** the wizard (now with a wildfire concern, a Resources step, a Data-sharing step and a site location), the plan page with its checklist, flash panel and decision cards, and a chat that writes the plan for you.
- **See the place:** live CDC Social Vulnerability Index and EJScreen for the site, shown on the plan and the **Analysis** page beside the station's readings, with one decision card per concern.
- **Forecast:** the **Forecast** page requests CREDIT runs (this machine, a community BOINC pool, or NCAR CIRRUS) and charts history, now and forecast with threshold lines.
- **Build together:** the **Community** page has a print queue per station and an offers board for printers, parts, hands and compute.
- **Run it:** accounts, a station registry with API keys, ingest at scale, CHORDS compatibility, an admin console, and the four steps below.

All of those pages talk to one server, the **hub**, which this site serves itself at `/hub` from its own database, with accounts deciding who can read and write. It speaks the same API as v3's standalone community server, so the optional stack in `infra/` can attach to it, or replace it (point the pages at it under "Where the page looks for your services").

## The four steps

1. **Configure**: the wizard and the flasher's setup form, preselected from your plan.
2. **Flash**: put the firmware on the board.
3. **Deploy and Publish** (`/deploy`): give the station its address and key, watch it come online, then choose who can see it and how to share it on the NCAR network.
4. **Track and Forecast** (`/track`): the station's own history and latest readings, and a forecast line from the built-in stand-in or from a CREDIT run (local or NCAR CIRRUS) that you load as a file.

The same four-step bar is on every one of those pages, including the flasher. Radio (LoRa) plans get one more stop between 2 and 3: a guide for the Raspberry Pi gateway (`/raspberry-pi`), which installs NCAR's `edge-servers` code as a service that starts at boot and restarts itself. No other plan sees it.

## Try it on your computer (no Docker)

```bash
npm install
npm run dev          # http://localhost:8080
```

The first account you create becomes the super-admin; staff sign in at `/admin/login` (not linked from the site). Dev mode uses an embedded database that
resets when you stop the server. Needs Node 22 (20.19+ works for the app).

Check the whole flow (sign up → register a station → upload → chart → admin):

```bash
npm run e2e
```

## Run it for real (Docker)

```bash
cp .env.example .env     # set POSTGRES_PASSWORD and BETTER_AUTH_SECRET; set PUBLIC_URL / SITE_ADDRESS for your domain
docker compose up -d --build
```

Open the address you set. Scale the web/API tier with `docker compose up -d --scale app=4`.
For stations that speak MQTT add the broker and bridge: `docker compose --profile mqtt up -d`
(create `deploy/mosquitto/passwd` first, see the comments in `deploy/mosquitto/`).

## Send data from a station

```bash
curl -X POST https://YOUR-SITE/api/ingest \
  -H "x-api-key: iotwx_…" -H "content-type: application/json" \
  -d '{"values":{"temp_c":21.4,"humidity_pct":40}}'
```

Batches: `{"readings":[{"ts":"2026-01-01T12:00:00Z","values":{…}}, …]}` (up to 500 per request).
`202` accepted · `401` bad or disabled key · `429` too fast · `503` server busy (retry after the
`Retry-After` seconds; resending is safe).

## CHORDS

Devices that already report to a CHORDS portal can point at this server unchanged
(`/measurements/url_create?instrument_id=…`), and downloads use the CHORDS addresses
(`/instruments/<id>.csv`). To pull in data from an existing portal use **My system → Import from CHORDS**.
Details and limits: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#chords-compatibility).

## Scripts

| | |
|---|---|
| `npm run dev` | dev server on :8080 |
| `npm run e2e` | browser tests: sign-up → station → upload → chart, and roles/user management |
| `npm run e2e:steps` | the four-step flow: step bar, Deploy and Publish, Track and Forecast |
| `npm run e2e:pi` | the Raspberry Pi guide: shown only to radio plans, commands follow your names |
| `npm run e2e:polish` | smooth scroll, logo hover, the animated chat with its avatar |
| `npm run e2e:flasher` | the browser flasher end to end: Configure → Flash, four-step bar, phone menu |
| `npm run e2e:v3` | v3's pages and the hub: wizard steps, Analysis, Forecast, Community, consent, who can write what (start the server with `HUB_TOKEN=hubtest`) |
| `npm run e2e:chords` | CHORDS upload/download/import (start the server with `CHORDS_ALLOW_PRIVATE=1`) |
| `npm run loadtest` | ingest load test (needs `DATABASE_URL`) |
| `npm run typecheck` / `npm test` | checks (tests need Node 22) |
