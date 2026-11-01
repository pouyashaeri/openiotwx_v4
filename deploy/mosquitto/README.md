# MQTT broker setup (optional)

Create the two broker accounts once, before `docker compose --profile mqtt up -d`:

```bash
cd deploy/mosquitto
touch passwd
docker run --rm -v "$PWD:/c" eclipse-mosquitto:2 mosquitto_passwd -b /c/passwd stations 'STATION_PASSWORD'
docker run --rm -v "$PWD:/c" eclipse-mosquitto:2 mosquitto_passwd -b /c/passwd bridge   'BRIDGE_PASSWORD'
```

Put `BRIDGE_PASSWORD` in `.env` as `MQTT_BRIDGE_PASSWORD` and set `INGEST_BRIDGE_TOKEN` to a long random string.

Stations connect as `stations` and publish JSON to `openiotwx/<anything>` (QoS 1):

```json
{"key":"iotwx_…","values":{"temp_c":21.4}}
```

`passwd` is git-ignored material; do not commit it.

## Raspberry Pi gateways

A gateway running the NCAR `pi_lora.py` publishes each reading to `sensors/<station_id>` with no key. Point its
`pi_config.json` at this broker (user `stations`) and, on the station's page in the app, enter the station id the
gateway reports under "Raspberry Pi gateway". The bridge files the readings under that station. Anyone holding the
`stations` password can publish for any registered gateway id, so keep that password to people you trust.
