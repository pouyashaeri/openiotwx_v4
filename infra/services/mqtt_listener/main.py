"""
Turns MQTT messages into rows. Subscribes to the community topic filter and posts every
reading to the database API, the way mesonet-siparcs25's mqtt_listener does, with three
payload shapes accepted:

  {"station_id": "s1", "measurement": "temperature", "reading_value": 21.3, ...}   (one reading)
  {"station_id": "s1", "temperature": 21.3, "humidity": 44, "latitude": 40.0, ...}  (a bundle)
  s1,temperature,21.3                                                               (classic csv line)

The station id falls back to the last segment of the topic (ncar/iotwx/<state>/<place>/<station>).
"""
from __future__ import annotations

import json
import os
import time

import paho.mqtt.client as mqtt
import requests

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_TOPIC = os.environ.get("MQTT_TOPIC", "ncar/iotwx/#")
API_URL = os.environ.get("API_URL", "http://database_api:8000").rstrip("/")
META = {"latitude", "longitude", "altitude", "rssi", "station_id", "station", "device", "edge_id", "timestamp", "time"}


def post(reading: dict) -> None:
    try:
        r = requests.post(f"{API_URL}/api/readings/", json=reading, timeout=10)
        if r.status_code >= 300:
            print(f"[warn] api {r.status_code}: {r.text[:120]}")
    except requests.RequestException as exc:
        print(f"[warn] api unreachable: {exc}")


def readings_from(topic: str, payload: str) -> list[dict]:
    station = topic.rstrip("/").split("/")[-1] or "unknown"
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        parts = [p.strip() for p in payload.split(",")]
        if len(parts) >= 3:
            try:
                return [{"station_id": parts[0] or station, "measurement": parts[1], "reading_value": float(parts[2])}]
            except ValueError:
                return []
        return []
    if not isinstance(data, dict):
        return []
    sid = str(data.get("station_id") or data.get("station") or station)
    common = {
        "station_id": sid,
        "latitude": data.get("latitude"),
        "longitude": data.get("longitude"),
        "edge_id": data.get("edge_id"),
        "rssi": data.get("rssi"),
        "timestamp": data.get("timestamp"),
    }
    if "measurement" in data and "reading_value" in data:
        try:
            return [{**common, "measurement": str(data["measurement"]), "reading_value": float(data["reading_value"]),
                     "sensor_model": data.get("sensor_model"), "sensor_protocol": data.get("sensor_protocol")}]
        except (TypeError, ValueError):
            return []
    out = []
    for key, value in data.items():
        if key in META or not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        out.append({**common, "measurement": key, "reading_value": float(value)})
    return out


def on_connect(client, userdata, flags, reason_code, properties=None):  # noqa: ANN001
    print(f"[info] connected to {MQTT_HOST}:{MQTT_PORT} ({reason_code}); subscribing {MQTT_TOPIC}")
    client.subscribe(MQTT_TOPIC, qos=1)


def on_message(client, userdata, msg):  # noqa: ANN001
    for reading in readings_from(msg.topic, msg.payload.decode("utf-8", "replace")):
        post(reading)


def main() -> None:
    for _ in range(30):
        try:
            if requests.get(f"{API_URL}/health", timeout=5).status_code == 200:
                break
        except requests.RequestException:
            pass
        time.sleep(2)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="openiotwx-listener", clean_session=False)
    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
    client.loop_forever()


if __name__ == "__main__":
    main()
