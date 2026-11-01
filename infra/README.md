# OpenIoTwx v3 community infrastructure

> **Two ways to use this folder.**
>
> 1. **Standalone, as v3 shipped it.** Run the stack below on its own: it has its own broker,
>    database and API. In the website, open any page's "Where the page looks for your services"
>    panel and point the community server at it (for example `http://localhost:8000`).
> 2. **Attached to the website's built-in hub.** The website already serves this same API at
>    `/hub`, from its own database, with accounts. You then only need the services that do work the
>    site cannot: the CREDIT runner, the place loader, the GDEX publisher. Give each
>    `API_URL=https://<your-site>/hub` and `HUB_TOKEN=<the same token you set on the site>`
>    (`HUB_TOKEN` in the site's `.env`). The runner and the place loader send it on every write.
>    Metabase and the MQTT listener in this folder expect v3's own tables, so they stay with the
>    standalone stack.

Everything the website's Plan, Analysis, Forecast, and Community pages talk to. One machine
runs it: a Raspberry Pi 4/5 (8 GB) for a handful of stations, a spare PC for a town, or NCAR
CIRRUS for a region, with the same containers.

```
stations ──MQTT──▶ mosquitto ──▶ mqtt_listener ──▶ database_api ──▶ Postgres/Timescale ◀── Metabase
                      │                                   ▲              ▲      ▲
   browser live feed ─┘ (WebSockets :9001)                │              │      └── metabase_orch (collections, questions, dashboards)
                                                 place_loader (SVI tract + EJScreen buffer per station)
                                                 credit_runner (CREDIT rollouts; local | boinc | cirrus)
                                                 gdex_publisher (consent-gated monthly packages) ──▶ IPFS pin ──▶ GDEX
```

It follows [NCAR/mesonet-siparcs25](https://github.com/NCAR/mesonet-siparcs25): the same
broker → listener → API → Metabase chain and the same CREDIT recipe, with the v3 tables added.

## Quick start (10 minutes)

```bash
cd infra
cp .env.example .env            # change the three passwords
docker compose up -d            # broker, database, API, listener, Metabase, place loader, demo station
```

Then:

| What | Where |
| --- | --- |
| Community server (API) | http://localhost:8000 — `GET /health`, docs at `/docs` |
| Metabase portal | http://localhost:3000 — sign in with `MB_ADMIN_EMAIL` / `MB_ADMIN_PASSWORD` |
| MQTT for stations | `mqtt://<host>:1883`, topic `ncar/iotwx/<state>/<place>/<station>` |
| MQTT for the browser live feed | `ws://<host>:9001` |

Open the website, go to **Analysis → Where the page looks for your services**, and point it at
this host if it is not the same machine. The demo station publishes one reading a minute so the
portal has data immediately; set `DEMO_STATION=0` once a real station is on the broker.

On a phone or another computer on the same network, use the host's LAN address in place of
`localhost` (for example `http://192.168.1.20:8000`). Browsers block `ws://` from an `https://`
page, so the live feed needs either an `http://` copy of the site or TLS on the broker (see
"Public hosts").

## Optional profiles

```bash
docker compose --profile forecast up -d     # credit_runner: CREDIT on this machine (CPU works; GPU is fast)
docker compose --profile volunteer up -d    # boinc_client: lend this machine to the community pool
docker compose --profile archive up -d      # ipfs + gdex_publisher
```

### Forecasting (CREDIT)

The runner polls `/api/forecast-runs/` for `backend = local` requests from the Forecast page,
then does what `mesonet-siparcs25/cloud/services/credit/scripts/credit.sh` does: `gfs_init.py`
→ `rollout_realtime.py` → nearest grid point per station → `POST /api/credit-forecast/`.
First run downloads the GFS analysis (~2 GB) and needs the CREDIT checkpoint and static files
in the `credit_data` volume:

```bash
docker compose run --rm credit_runner bash -c \
  "mkdir -p /data/checkpoint /data/static && echo 'copy model_checkpoint.pt and the static_data files here'"
```

`services/credit_runner/model.yml` is the siparcs25 6-hourly crossformer configuration; swap in
another CREDIT config and checkpoint the same way. Build with `--build-arg ENV_FILE=environment.yml`
on a CUDA host and uncomment the GPU reservation in `docker-compose.yml`.

Variables: CREDIT provides 2 m temperature (`t2m`), surface pressure (`SP`), and 500 hPa winds
(`U500`, `V500`, stored as `wind10` speed). Rain and PM2.5 are not in that configuration, so the
website labels them GFS/HRRR; add a `gfs` source row set from the same `gfs_init` download if you
want them on the chart, or change the CREDIT config to one that outputs precipitation.

### Community compute pool (BOINC)

See [`boinc/README.md`](boinc/README.md). Short version: the steward runs the small BOINC
project server with the `credit_tile` app from `boinc/project/`, sets `BOINC_PROJECT_URL` and
`BOINC_ACCOUNT_KEY` in `.env`, and volunteers attach with the client. The Forecast page's
"Community compute pool" option turns on when the project URL is set.

### NCAR CIRRUS (Kubernetes)

```bash
cd helm
kubectl create ns openiotwx
kubectl -n openiotwx create secret generic openiotwx-db --from-literal=password=...
kubectl -n openiotwx create secret generic openiotwx-metabase --from-literal=email=... --from-literal=password=...
# build and push the images in services/* to your CIRRUS registry (hub.k8s.ucar.edu/<project>)
helm upgrade --install openiotwx . -n openiotwx -f values.yaml --set app.domain=<project>.k8s.ucar.edu
```

Hostnames follow the siparcs25 pattern (`api.<domain>`, `metabase.<domain>`). Set
`CIRRUS_ENABLED=1` on the API so the Forecast page can queue `backend = cirrus` runs. The same
chart deploys to an OpenStack-hosted Kubernetes or any other cluster.

### Archive and publish (IPFS + GDEX)

> **The site itself now builds GDEX releases** from its own database: per-station consent, monthly or
> quarterly CF-compliant NetCDF, a quality report and a public manifest GDEX can pull. See
> [docs/GDEX.md](../docs/GDEX.md). What follows is the standalone stack's own publisher. Its upload step
> (`GDEX_ENDPOINT`) assumes an upload API that GDEX has not confirmed: GDEX described a pull model
> (you give them the location of the data after creating a submission), so treat that step as
> unverified and leave `GDEX_DRY_RUN=1` until they say otherwise.
>
> To turn a release's NetCDF-3 file into NetCDF-4 with compression and chunking:
> `python services/gdex_publisher/netcdf4_convert.py <file>.nc`.

Nothing is published unless two things are true: the plan's GDEX switch is on **and** a consent
row exists for the station (the "Record this decision" button on the plan, `POST /api/consent/`).
Then, once a day, `gdex_publisher` packages the previous month per station:

* `exports/<station>/<YYYY-MM>/<station>_<YYYYMM>.nc` (CF-1.8), `.parquet`, and `metadata.json`
* pinned on the community IPFS node (CID recorded in `gdex_publications`)
* uploaded to GDEX when `GDEX_DRY_RUN=0` and `GDEX_ENDPOINT`/`GDEX_TOKEN`/`GDEX_COLLECTION` are set

GDEX assigns collections through its data submission process. Request one with roughly:

> Project: OpenIoTwx community station network, <place>. Data: 1–10 minute surface observations
> (air temperature, humidity, pressure, wind, rain, PM2.5; see metadata.json), CF-1.8 NetCDF and
> Parquet, monthly, with hourly means. License: CC BY 4.0. Steward: <name, contact>. Locations
> rounded to ~100 m; no personal data. Expected volume: <N> stations × ~5 MB/month.

Until a collection is assigned, leave `GDEX_DRY_RUN=1`: packages are written and pinned, nothing
is sent, and `GET /api/publications/` shows `dry-run` rows so the group can inspect them.

## Public hosts

* Set `allow_anonymous false` in `mosquitto/mosquitto.conf` and add a password file.
* Put the API and Metabase behind TLS (Caddy or Traefik, or the CIRRUS ingress). Add the site's
  origin to `CORS_ORIGINS`.
* Add a TLS listener to Mosquitto (`listener 9443`, `protocol websockets`, `certfile`/`keyfile`)
  so the live feed works from the `https://` site.

## What is stored, and where

| Table | What |
| --- | --- |
| `stations`, `readings` (hypertable), `readings_hourly` | the mesonet |
| `svi_tracts`, `ej_indicators`, view `station_context` | place profile, joined per station |
| `forecast_runs`, `credit_forecasts`, view `forecast_verification` | forecasts and how they did |
| `collective_members`, `collective_inventory` | build collective (contact details stay here) |
| `data_consent`, `gdex_publications` | who decided what, and what left |

Back up the `postgres_data` volume and the `exports/` folder; everything else is reproducible.
