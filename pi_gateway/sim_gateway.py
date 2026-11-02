#!/usr/bin/env python3
"""
Pretends to be the Raspberry Pi gateway hearing an RP2040 station, without any radio.

It builds the same packets the RP2040 firmware sends (the ones in pi_lora_sim.py), turns them into messages the
way pi_lora.py does, and sends them to your website through site_uploader.py. Use it to check the website side
before you change anything on the Pi:

    python sim_gateway.py --url http://localhost:8080 --key THE_KEY_FROM_THE_DEPLOY_PAGE

Open the station's page: you should see Air temperature, Humidity, Pressure and so on, and the station placed on
the map at the GPS position below. Stop with Ctrl+C. Needs only Python 3.8 or newer.
"""

import argparse
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from site_uploader import SiteUploader  # noqa: E402

STATION = "DF643CF0136D5D26"  # an RP2040's own id, as the firmware reports it

# Copied from pi_lora.py (map_packet_fields): the short names on the radio become full names.
FIELD_MAP = {
    "sid": "station_id", "t": "type", "s": "sensor", "m": "measurement", "d": "reading_value", "p": "sensor_protocol",
    "lat": "latitude", "lon": "longitude", "rh": "relative_humidity", "tmp": "temperature", "pre": "pressure",
    "gr": "gas_resistance", "al": "altitude", "ts": "timestamp",
}
TYPES = {"A": "ping", "B": "pong", "E": "station_info", "F": "sensor_data"}


def map_packet_fields(packet):
    out = {}
    for short, value in packet.items():
        full = FIELD_MAP.get(short, short)
        out[full] = TYPES.get(value, value) if full == "type" else FIELD_MAP.get(value, value)
    return out


def one_round(i):
    """The packets of one reading burst: GPS, then the BME680 measurements."""
    wobble = random.uniform(-0.4, 0.4)
    packets = [
        ("pa1010d", "lat", 40.01),
        ("pa1010d", "lon", -105.27),
        ("bme680", "tmp", round(23.5 + wobble + (i % 10) * 0.05, 2)),
        ("bme680", "rh", round(34.2 - wobble, 1)),
        ("bme680", "pre", round(1013.2 + wobble / 4, 1)),
        ("bme680", "gr", round(120.5 + wobble, 1)),
        ("bme680", "al", 1655.0),
    ]
    return [{"t": "F", "sid": STATION, "s": s, "m": m, "d": d, "p": "i2"} for s, m, d in packets]


def main():
    parser = argparse.ArgumentParser(description="Send simulated gateway readings to an OpenIoTwx website.")
    parser.add_argument("--url", default="http://localhost:8080", help="the website address (default: %(default)s)")
    parser.add_argument("--key", required=True, help="the station's API key (iotwx_...)")
    parser.add_argument("--rounds", type=int, default=0, help="how many bursts to send, 0 for until Ctrl+C (default: %(default)s)")
    parser.add_argument("--every", type=float, default=5, help="seconds between bursts (default: %(default)s)")
    args = parser.parse_args()
    if not re.match(r"^iotwx_[A-Za-z0-9_-]{32}$", args.key):
        sys.exit("That is not a station key. A real key looks like iotwx_ followed by 32 letters and digits. Copy it from the station's Deploy page.")

    uploader = SiteUploader({"site": {"url": args.url, "api_key": args.key, "flush_seconds": 1}})
    uploader.start()
    i = 0
    try:
        while args.rounds == 0 or i < args.rounds:
            now = datetime.now(timezone.utc).isoformat()
            for packet in one_round(i):
                message = map_packet_fields(packet)
                message["timestamp"] = now
                message["rssi"] = -49
                uploader.offer(message)
            i += 1
            time.sleep(args.every if args.rounds == 0 or i < args.rounds else 1.5)
    except KeyboardInterrupt:
        pass
    uploader.flush()
    uploader.stop()
    print(f"Done. Sent {uploader.sent} readings, {uploader.pending()} still waiting, {uploader.dropped} dropped.")


if __name__ == "__main__":
    main()
