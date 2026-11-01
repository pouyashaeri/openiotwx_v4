#!/usr/bin/env python3
r"""
A pretend weather station for trying out OpenIoTwx.

It sends one reading to your server every few seconds, exactly like this curl command does:

    curl -X POST http://localhost:8080/api/ingest \
      -H "x-api-key: YOUR_STATION_KEY" -H "content-type: application/json" \
      -d '{"values":{"temp_c":21.4,"humidity_pct":48}}'

Run it in its own terminal and leave it going:

    python mock_station.py

Needs only Python 3.8 or newer. Nothing to install.
Stop it with Ctrl+C.

Change the three settings just below, or override any of them for one run:

    python mock_station.py --key iotwx_abc123 --interval 2
    python mock_station.py --server http://192.168.0.2:8080
"""

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request

# ── Settings: change these ───────────────────────────────────────────────────────────────────

# Where your OpenIoTwx server is running.
SERVER_URL = "http://localhost:8080"

# The station's API key. Make it on the station's Deploy page ("Make a key and show settings"),
# or copy the one shown when you add the station. It starts with iotwx_
API_KEY = "your API key of the station in here"

# How many seconds to wait between readings.
INTERVAL_SECONDS = 5

# Hours of past readings to send once at the start, so charts and the forecast have history right away.
# 0 sends none. 24 gives a full day (the built-in forecast needs about that to follow the daily cycle).
BACKFILL_HOURS = 0

# What to send. Each is: name -> (typical value, how far it can wander, lowest, highest, daily swing).
# Names the site already knows (temp_c, humidity_pct, pressure_hpa, ...) get proper labels and units
# on the charts. Delete lines you do not want, or add your own.
METRICS = {
    "temp_c": (18.0, 0.25, -30.0, 45.0, 6.0),
    "humidity_pct": (55.0, 0.8, 5.0, 100.0, -12.0),
    "pressure_hpa": (1012.0, 0.15, 950.0, 1060.0, 0.0),
    "soil_moisture_pct": (31.0, 0.2, 0.0, 100.0, 0.0),
    "soil_temp_c": (16.0, 0.08, -10.0, 40.0, 2.0),
    "co2_ppm": (425.0, 3.0, 380.0, 2000.0, 0.0),
}

# ─────────────────────────────────────────────────────────────────────────────────────────────


class Wanderer:
    """A value that drifts a little each time, follows a daily cycle, and stays inside its limits."""

    def __init__(self, typical, step, low, high, swing):
        self.typical, self.step, self.low, self.high, self.swing = typical, step, low, high, swing
        self.drift = 0.0

    def next(self, now):
        # Warmest mid-afternoon (15:00), coolest before dawn. A negative swing flips it (humidity).
        hour = (now % 86400) / 3600.0
        daily = self.swing * math.sin((hour - 9.0) / 24.0 * 2.0 * math.pi)
        limit = 10 * self.step  # how far the slow drift may stray from the typical value
        self.drift = max(-limit, min(limit, self.drift * 0.95 + random.uniform(-self.step, self.step)))
        value = self.typical + daily + self.drift
        return round(max(self.low, min(self.high, value)), 2)


def send(server, key, payload):
    """POST a body ({"values": {...}} or {"readings": [...]}). Returns (HTTP status, response text, seconds to wait)."""
    body = json.dumps(payload).encode()
    request = urllib.request.Request(
        server.rstrip("/") + "/api/ingest",
        data=body,
        method="POST",
        headers={"x-api-key": key, "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read().decode(errors="replace"), 0
    except urllib.error.HTTPError as error:
        text = error.read().decode(errors="replace")
        try:
            wait = int(error.headers.get("retry-after", "0"))
        except ValueError:
            wait = 0
        return error.code, text, wait


def backfill(server, key, wanderers, hours):
    """Send the past `hours` of readings (one every 15 minutes) in one go, so charts and the forecast have history."""
    now = time.time()
    steps = int(hours * 4)
    readings = []
    for i in range(steps, 0, -1):
        t = now - i * 900
        readings.append({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t)), "values": {n: w.next(t) for n, w in wanderers.items()}})
    done = 0
    for start in range(0, len(readings), 400):  # the server takes up to 500 readings per request
        status, text, _ = send(server, key, {"readings": readings[start:start + 400]})
        if status not in (200, 202):
            sys.exit(f"Could not send the history: the server answered {status}: {text.strip()[:200]}")
        done += len(readings[start:start + 400])
    print(f"Sent {done} readings of history covering the last {hours:g} hours.\n")


def main():
    parser = argparse.ArgumentParser(description="Send pretend readings to an OpenIoTwx server.")
    parser.add_argument("--server", default=os.environ.get("IOTWX_SERVER", SERVER_URL), help="server address (default: %(default)s)")
    parser.add_argument("--key", default=os.environ.get("IOTWX_API_KEY", API_KEY), help="the station's API key")
    parser.add_argument("--interval", type=float, default=INTERVAL_SECONDS, help="seconds between readings (default: %(default)s)")
    parser.add_argument("--backfill", type=float, default=BACKFILL_HOURS, metavar="HOURS", help="first send this many hours of past readings, so charts and the forecast have history (default: %(default)s)")
    args = parser.parse_args()
    sys.stdout.reconfigure(line_buffering=True)  # show each line at once, even when output is piped to a file

    if not args.key.startswith("iotwx_") or "PUT_YOUR" in args.key:
        sys.exit("Put the station's API key in API_KEY at the top of this file (or use --key). It starts with iotwx_")
    if args.interval <= 0:
        sys.exit("The interval must be more than 0 seconds.")

    wanderers = {name: Wanderer(*spec) for name, spec in METRICS.items()}
    print(f"Mock station sending to {args.server} every {args.interval:g} s. Press Ctrl+C to stop.")
    print(f"Same as: curl -X POST {args.server.rstrip('/')}/api/ingest -H \"x-api-key: {args.key[:12]}...\" "
          f"-H \"content-type: application/json\" -d '{{\"values\":{{...}}}}'\n")

    if args.backfill > 0:
        try:
            backfill(args.server, args.key, wanderers, args.backfill)
        except (urllib.error.URLError, OSError) as error:
            sys.exit(f"Could not reach {args.server}: {getattr(error, 'reason', error)}. Is the site running?")

    sent = 0
    failed = 0
    try:
        while True:
            values = {name: w.next(time.time()) for name, w in wanderers.items()}
            stamp = time.strftime("%H:%M:%S")
            wait = 0
            try:
                status, text, wait = send(args.server, args.key, {"values": values})
            except (urllib.error.URLError, OSError) as error:
                failed += 1
                print(f"{stamp}  could not reach {args.server}: {getattr(error, 'reason', error)}. Trying again.")
            else:
                if status in (200, 202):
                    sent += 1
                    shown = "  ".join(f"{k}={v}" for k, v in values.items())
                    print(f"{stamp}  sent #{sent}  {shown}")
                elif status == 401:
                    sys.exit(f"{stamp}  the server did not accept this API key (401). Make a new one on the Deploy page and put it in API_KEY.")
                elif status == 429:
                    failed += 1
                    print(f"{stamp}  slow down: the server limits how often a station can send (429). Waiting {wait or 'a bit'} s.")
                else:
                    failed += 1
                    print(f"{stamp}  the server answered {status}: {text.strip()[:200]}")
            time.sleep(max(args.interval, wait))
    except KeyboardInterrupt:
        print(f"\nStopped. Sent {sent} readings" + (f", {failed} did not go through." if failed else "."))


if __name__ == "__main__":
    main()
