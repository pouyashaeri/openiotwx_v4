"""
Sends what the LoRa gateway hears to an OpenIoTwx website over HTTP.

pi_lora.py (the Raspberry Pi gateway from mesonet-siparcs25/edge-servers) forwards every reading to NCAR's
MQTT broker in the old text format. That never reaches an OpenIoTwx website. This module adds a second,
independent path: each reading is also posted to the website's /api/ingest/gateway endpoint with the
station's API key. The NCAR path is left as it was.

Rules it follows so it can never hurt the gateway:
  - offer() only puts a message in a list and returns. The radio loop never waits for the network.
  - Readings are sent in batches from a background thread.
  - If the site is down, readings wait (up to max_pending) and go when it is back, oldest first.
  - A wrong API key is reported and those readings are dropped, not retried forever.

Uses only the Python standard library, so nothing has to be installed on the Pi.

Settings live in a "site" section of pi_config.json:

    "site": {
      "url": "http://192.168.0.2:8080",
      "api_key": "iotwx_...",                      # used for every station the gateway hears
      "station_keys": {"DF643CF0136D5D26": "iotwx_..."},   # optional: one key per station id
      "flush_seconds": 5,
      "enabled": true
    }
"""

import json
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from itertools import islice

# Only these packet types carry readings or the station's position.
SENDABLE = ("sensor_data", "station_info")
# The fields the website reads. Everything else the radio heard stays on the Pi.
KEEP = ("type", "station_id", "sensor", "measurement", "reading_value", "timestamp", "latitude", "longitude", "altitude", "rssi")


class SiteUploader:
    def __init__(self, config, post=None):
        site = (config or {}).get("site") or {}
        self.url = str(site.get("url", "")).strip().rstrip("/")
        self.default_key = str(site.get("api_key", "")).strip()
        self.station_keys = {str(k): str(v).strip() for k, v in (site.get("station_keys") or {}).items() if str(v).strip()}
        self.flush_seconds = float(site.get("flush_seconds", 5))
        self.max_batch = int(site.get("max_batch", 100))
        self.max_pending = int(site.get("max_pending", 5000))
        self.enabled = bool(self.url) and site.get("enabled", True) is not False and bool(self.default_key or self.station_keys)
        self._post = post or self._http_post
        self._pending = {}  # API key -> messages waiting, oldest first
        self._lock = threading.Lock()
        self._flush_lock = threading.Lock()  # only one sender at a time, or two could send (and discard) the same readings
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = None
        self._warned = set()
        self._retry_at = 0.0
        self._backoff = 0.0
        self.sent = 0
        self.dropped = 0

    # ---- called from the radio loop: must be quick and must never raise ----

    def offer(self, msg):
        """Queue one decoded packet for the website. Returns True when it was queued."""
        try:
            if not self.enabled or msg.get("type") not in SENDABLE:
                return False
            station = msg.get("station_id")
            key = self.station_keys.get(station) or self.default_key
            if not key:
                self._warn_once(("nokey", station), f"No API key for station {station}. Add it under site.station_keys, or set site.api_key.")
                return False
            item = {k: msg[k] for k in KEEP if k in msg}
            with self._lock:
                self._pending.setdefault(key, deque()).append(item)
                self._trim()
                waiting = sum(len(q) for q in self._pending.values())
            if waiting >= self.max_batch:
                self._wake.set()
            return True
        except Exception as error:  # a problem here must never stop the radio loop
            self._warn_once(("offer", str(error)), f"Could not queue a reading for the site: {error}")
            return False

    # ---- the background sender ----

    def start(self):
        if not self.enabled:
            print('[info]: Site upload is off (no "site" section with a url and an api_key in pi_config.json)')
            return
        print(f"[info]: Site upload on: {self.url}")
        self._thread = threading.Thread(target=self._run, name="site-uploader", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self):
        while not self._stop.is_set():
            self._wake.wait(self.flush_seconds)
            self._wake.clear()
            if self._stop.is_set():
                break
            try:
                self.flush()
            except Exception as error:
                self._warn_once(("flush", str(error)), f"Site upload hit an error and will try again: {error}")

    def flush(self):
        """Send everything that is waiting. Returns True when nothing is left behind."""
        with self._flush_lock:
            return self._flush()

    def _flush(self):
        if time.time() < self._retry_at:
            return False
        with self._lock:
            keys = [k for k, q in self._pending.items() if q]
        for key in keys:
            while True:
                with self._lock:
                    batch = list(islice(self._pending.get(key, ()), self.max_batch))
                if not batch:
                    break
                outcome = self._deliver(key, batch)
                if outcome == "retry":
                    return False
                with self._lock:  # delivered or dropped: either way they leave the list
                    q = self._pending[key]
                    for _ in range(len(batch)):
                        q.popleft()
        self._backoff = 0.0
        return True

    def _deliver(self, key, batch):
        status, text, wait = self._post(key, batch)
        tail = f"(key ending {key[-4:]})"
        if status in (200, 202):
            self.sent += len(batch)
            print(f"[info]: Sent {len(batch)} readings to the site {tail}")
            return "ok"
        if status == 401:
            self._warn_once(("401", key), f"The site did not accept the API key {tail}. Make a new key on the station's Deploy page and put it in pi_config.json.")
            self.dropped += len(batch)
            return "dropped"
        if status in (400, 404, 413, 422):
            self._warn_once((status, key), f"The site refused these readings ({status}): {str(text).strip()[:160]}. They are dropped.")
            self.dropped += len(batch)
            return "dropped"
        # No answer, rate limit, or a server error: keep the readings and try again later, a little longer each time.
        self._backoff = min(60.0, max(wait, self._backoff * 2 if self._backoff else 5.0))
        self._retry_at = time.time() + self._backoff
        why = "could not reach the site" if status == 0 else f"the site answered {status}"
        self._warn_once(("retry", status), f"Site upload: {why}. Keeping {self.pending()} readings and trying again in {self._backoff:g} s.")
        self._warned.discard(("retry", status))  # say it again next time, so the log shows the outage going on
        return "retry"

    def _http_post(self, key, batch):
        """POST a batch. Returns (HTTP status or 0 when there was no answer, text, seconds the site asked us to wait)."""
        request = urllib.request.Request(
            self.url + "/api/ingest/gateway",
            data=json.dumps(batch).encode(),
            method="POST",
            headers={"content-type": "application/json", "x-api-key": key},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return response.status, response.read().decode(errors="replace"), 0
        except urllib.error.HTTPError as error:
            try:
                wait = int(error.headers.get("retry-after", "0"))
            except ValueError:
                wait = 0
            return error.code, error.read().decode(errors="replace"), wait
        except (urllib.error.URLError, OSError) as error:
            return 0, str(getattr(error, "reason", error)), 0

    # ---- helpers ----

    def pending(self):
        with self._lock:
            return sum(len(q) for q in self._pending.values())

    def _trim(self):
        """Keep the list bounded: when it is full, the oldest readings go first."""
        while sum(len(q) for q in self._pending.values()) > self.max_pending:
            fullest = max(self._pending.values(), key=len)
            fullest.popleft()
            self.dropped += 1

    def _warn_once(self, key, text):
        if key not in self._warned:
            self._warned.add(key)
            print(f"[warn]: {text}")
