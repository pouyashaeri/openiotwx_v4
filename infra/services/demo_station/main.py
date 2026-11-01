"""
A pretend station, so the portal has readings on day one. Publishes a plausible diurnal cycle
once a minute on the demo topic in the bundle format real stations use. Turn it off with
DEMO_STATION=0 once a real board is on the broker.
"""
from __future__ import annotations

import json
import math
import os
import random
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

if os.environ.get("ENABLED", "1") != "1":
    print("[info] demo station disabled")
    while True:
        time.sleep(3600)

HOST = os.environ.get("MQTT_HOST", "mosquitto")
TOPIC = os.environ.get("MQTT_TOPIC", "ncar/iotwx/co/demo/demo_station")
STATION = os.environ.get("STATION_ID", "demo_station")
LAT = float(os.environ.get("LATITUDE", "40.015"))
LON = float(os.environ.get("LONGITUDE", "-105.2705"))
INTERVAL = int(os.environ.get("INTERVAL_SECONDS", "60"))

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"{STATION}-demo")
client.connect(HOST, 1883, keepalive=60)
client.loop_start()
smoke = 8.0
print(f"[info] publishing {STATION} on {TOPIC} every {INTERVAL}s")
while True:
    now = datetime.now(timezone.utc)
    hour = now.hour + now.minute / 60
    diurnal = math.sin((hour - 9) / 24 * math.tau)
    smoke = max(3.0, smoke + random.uniform(-1.5, 1.5))
    payload = {
        "station_id": STATION,
        "latitude": LAT,
        "longitude": LON,
        "timestamp": now.isoformat(),
        "temperature": round(22 + 7 * diurnal + random.uniform(-0.4, 0.4), 2),
        "humidity": round(max(10, min(95, 52 - 22 * diurnal + random.uniform(-2, 2))), 1),
        "pressure": round(1012 + 1.5 * math.sin(hour / 24 * math.tau) + random.uniform(-0.3, 0.3), 1),
        "wind_speed": round(max(0, 3 + 4 * max(0, diurnal) + random.uniform(-1, 1)), 2),
        "rain": round(random.uniform(0, 1.2) if random.random() > 0.95 else 0.0, 2),
        "pm25": round(smoke, 1),
        "rssi": -62,
    }
    client.publish(TOPIC, json.dumps(payload), qos=1)
    time.sleep(INTERVAL)
