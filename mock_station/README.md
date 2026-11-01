# Mock station

A pretend weather station. It sends one believable reading to your OpenIoTwx server every few seconds, so you can see charts fill up, test the forecast and try the GDEX checks without any hardware.

It does exactly what this curl command does, again and again:

```
curl -X POST http://localhost:8080/api/ingest \
  -H "x-api-key: YOUR_STATION_KEY" -H "content-type: application/json" \
  -d '{"values":{"temp_c":21.4,"humidity_pct":48}}'
```

## Run it

1. Start the site (`npm run dev`) and register a station. Get its API key from the station's **Deploy** page (**Make a key and show settings**), or copy the key shown when you add the station.
2. Open `mock_station.py` and set the key near the top:

   ```python
   SERVER_URL = "http://localhost:8080"
   API_KEY = "iotwx_..."          # your station's key
   INTERVAL_SECONDS = 5           # seconds between readings
   ```

3. In a second terminal, from this folder:

   ```
   python mock_station.py
   ```

   Stop it with Ctrl+C. It needs Python 3.8 or newer and nothing else (no packages to install).

You will see a line for every reading, and the station's Deploy page changes to **Reporting** within a few seconds.

## Change it for one run

You do not have to edit the file. These override the settings for that run:

```
python mock_station.py --key iotwx_abc123 --interval 2
python mock_station.py --server http://192.168.0.2:8080
```

The environment variables `IOTWX_API_KEY` and `IOTWX_SERVER` work too.

## See a forecast right away

The Track and Forecast page draws a forecast line once a station has about a day of history. To skip the wait, send the past day first:

```
python mock_station.py --backfill 24
```

That sends 24 hours of readings (one every 15 minutes) in one go, then carries on live. You can also set `BACKFILL_HOURS` at the top of the file.

## What it sends

Six readings by default: `temp_c`, `humidity_pct`, `pressure_hpa`, `soil_moisture_pct`, `soil_temp_c` and `co2_ppm`. They drift slowly and follow a daily cycle (warmer in the afternoon, damper at night), so charts look like real weather. Edit the `METRICS` list in the script to remove some or add your own. Each line says: typical value, how far it can wander, lowest, highest, and the size of the daily swing.

## Notes

- One station key belongs to one station. Use a separate test station for mock data, and keep it out of any GDEX release you mean to publish.
- If you send faster than the server allows, it answers `429` and the script waits before the next reading.
- A `401` means the key is wrong or was replaced (making a new key stops the old one). The script stops and tells you.
- If the site is not running, the script keeps trying and carries on when it is back.
