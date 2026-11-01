# What happened to the legacy mesonet stack

The legacy `mesonet-siparcs25` project ran as a pile of services. Everything people used to reach through
ThingsBoard, Metabase, pgAdmin or the map server is now part of this one app, behind one login.

| Legacy piece | What it did | Where it lives now |
|---|---|---|
| Pi gateway (`pi_lora.py`) → MQTT `sensors/<station_id>` | Forwarded each radio reading, one measurement per message | Same gateway, same format. `scripts/mqtt-bridge.mjs` reads `sensors/#` and `POST /api/ingest/gateway` accepts the same messages over HTTP |
| `mqtt_listener` | Wrote readings and station info to Postgres, kept station position | `src/lib/legacy/gateway.ts` turns messages into readings, and position packets (`station_info`, latitude, longitude, altitude) move the station |
| `database_api` + Postgres | Stations, readings, forecasts | Platform tables (`stations`, `measurements`, `credit_forecasts`) and the server functions in `src/lib/platform` |
| `map_server` (Leaflet, Redis, Socket.IO) | Live map of every station | `/map`: Leaflet, clustered pins, status colours, a reading on each pin, search, filters, three base maps. Polls every 20 s. Also draws every instrument on the public CHORDS portals (NCAR IoTWx, 3D-PAWS, SugarTech; signed-in users can add more), cached ten minutes |
| Metabase orchestrator | A collection, dashboard and login per station and per user | Not needed. Every station has its own page (charts, downloads, summary) under the same account. Network-wide numbers are on the map and the admin console |
| ThingsBoard orchestrator | A device and dashboard per station | Registering a station creates it, with its key, in one step. Nothing to log in to |
| pgAdmin / SQL access | Looking at tables | Admin console → Database: size, row counts, browse and download any table (secret columns are never listed) |
| `model_service` (LLM weather summary) | Short plain-language conditions text | "Right now" box on each station page (`src/lib/platform/summary.ts`), deterministic and instant |
| CREDIT forecasts | Daily forecast per station | Overlay on charts, the Forecast page, and the hub (see ARCHITECTURE) |
| Mean radiant temperature | Computed in the listener | The device sends it (`mrt` / `mrt_calculated_mrt`). The app only labels and charts it |

## Deploy your own, or join the NCAR network

Every station is private to its owner until they choose otherwise:

1. **Private** (default): only the owner (and admins) see it.
2. **Shared**: appears on the public map and station list.
3. **NCAR research network**: a switch on the station page (or a tick box when registering from a plan). It needs a
   location, makes the station public, and flags it for the network map and the research hub. It is reversible;
   leaving keeps the station public until the owner makes it private, and data already shared stays shared.

## Getting a Raspberry Pi gateway's data in

1. Flash and set up the gateway from the Raspberry Pi page. Set its broker to this site's MQTT broker
   (`docker compose --profile mqtt up -d`, see `deploy/mosquitto/README.md`).
2. On the station's page, enter the station id the gateway reports under "Raspberry Pi gateway".
3. The bridge files each message under that station. A station without a registered id is ignored (answered 404).

Messages carry no API key, so the broker password is what keeps strangers out. Keep it to people you trust.
