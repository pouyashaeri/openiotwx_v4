"""
Tests for the website upload. They need no Raspberry Pi and no running site:

    python -m unittest pi_gateway/test_pi_gateway.py -v        (from the project root)
"""

import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from site_uploader import SiteUploader  # noqa: E402


class Site:
    """A tiny stand-in for the website: records what it is sent and answers with a chosen status."""

    def __init__(self):
        self.requests = []
        self.answers = []  # statuses to answer with, in order; then 202
        site = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                body = self.rfile.read(int(self.headers.get("content-length", "0")))
                site.requests.append({"path": self.path, "key": self.headers.get("x-api-key"), "body": json.loads(body)})
                status = site.answers.pop(0) if site.answers else 202
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"accepted":1}')

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()


def reading(station="STATION1", measurement="temperature", value=21.4, kind="sensor_data"):
    return {
        "type": kind,
        "station_id": station,
        "sensor": "bme680",
        "measurement": measurement,
        "reading_value": value,
        "timestamp": "2026-11-02T12:00:00+00:00",
        "rssi": -49,
        "load": 0.2,  # something the website does not need: it must not be sent
    }


def uploader(site, **extra):
    config = {"site": {"url": site.url, "api_key": "iotwx_defaultkey1234", **extra}}
    return SiteUploader(config)


class UploaderTests(unittest.TestCase):
    def setUp(self):
        self.site = Site()

    def tearDown(self):
        self.site.close()

    def test_one_batch_with_the_key_and_only_the_fields_the_site_reads(self):
        up = uploader(self.site)
        for m in ("temperature", "relative_humidity", "pressure"):
            self.assertTrue(up.offer(reading(measurement=m)))
        self.assertFalse(up.offer(reading(kind="ping")))  # radio chatter is not forwarded
        self.assertTrue(up.flush())
        self.assertEqual(len(self.site.requests), 1)
        sent = self.site.requests[0]
        self.assertEqual(sent["path"], "/api/ingest/gateway")
        self.assertEqual(sent["key"], "iotwx_defaultkey1234")
        self.assertEqual([r["measurement"] for r in sent["body"]], ["temperature", "relative_humidity", "pressure"])
        self.assertNotIn("load", sent["body"][0])
        self.assertEqual(up.pending(), 0)
        self.assertEqual(up.sent, 3)

    def test_station_position_packets_are_forwarded(self):
        up = uploader(self.site)
        up.offer({"type": "station_info", "station_id": "STATION1", "latitude": 40.01, "longitude": -105.27, "altitude": 1655, "email": "private@example.org"})
        up.flush()
        sent = self.site.requests[0]["body"][0]
        self.assertEqual((sent["latitude"], sent["longitude"], sent["altitude"]), (40.01, -105.27, 1655))
        self.assertNotIn("email", sent)  # personal details stay on the Pi

    def test_each_station_uses_its_own_key(self):
        up = uploader(self.site, station_keys={"B": "iotwx_keyforstationB1"})
        up.offer(reading(station="A"))
        up.offer(reading(station="B"))
        up.flush()
        keys = {r["key"]: [x["station_id"] for x in r["body"]] for r in self.site.requests}
        self.assertEqual(keys, {"iotwx_defaultkey1234": ["A"], "iotwx_keyforstationB1": ["B"]})

    def test_a_station_with_no_key_is_skipped_not_sent_to_the_wrong_station(self):
        config = {"site": {"url": self.site.url, "station_keys": {"A": "iotwx_keyforstationA1"}}}
        up = SiteUploader(config)
        self.assertTrue(up.offer(reading(station="A")))
        self.assertFalse(up.offer(reading(station="Z")))

    def test_it_is_off_without_a_site_section(self):
        self.assertFalse(SiteUploader({}).enabled)
        self.assertFalse(SiteUploader({"site": {"url": self.site.url}}).enabled)  # no key
        self.assertFalse(SiteUploader({"site": {"url": self.site.url, "api_key": "iotwx_x" * 3, "enabled": False}}).enabled)

    def test_when_the_site_is_down_readings_wait_and_go_in_order_later(self):
        self.site.answers = [500]
        up = uploader(self.site)
        for v in (1, 2, 3):
            up.offer(reading(value=v))
        self.assertFalse(up.flush())  # the site said 500
        self.assertEqual(up.pending(), 3)
        up._retry_at = 0  # skip the wait
        self.assertTrue(up.flush())
        self.assertEqual([r["reading_value"] for r in self.site.requests[-1]["body"]], [1, 2, 3])
        self.assertEqual(up.pending(), 0)

    def test_a_wrong_key_is_dropped_not_retried_for_ever(self):
        self.site.answers = [401]
        up = uploader(self.site)
        up.offer(reading())
        self.assertTrue(up.flush())
        self.assertEqual(up.pending(), 0)
        self.assertEqual(up.dropped, 1)
        self.assertEqual(len(self.site.requests), 1)

    def test_a_site_that_cannot_be_reached_does_not_slow_the_radio_loop(self):
        up = SiteUploader({"site": {"url": "http://127.0.0.1:9", "api_key": "iotwx_defaultkey1234"}})
        start = time.time()
        for i in range(2000):
            up.offer(reading(value=i))
        self.assertLess(time.time() - start, 1.0)
        self.assertFalse(up.flush())  # nothing listens there: kept for later
        self.assertEqual(up.pending(), 2000)

    def test_the_waiting_list_is_bounded_and_the_oldest_go_first(self):
        up = uploader(self.site, max_pending=5)
        for i in range(8):
            up.offer(reading(value=i))
        self.assertEqual(up.pending(), 5)
        self.assertEqual(up.dropped, 3)
        up.flush()
        self.assertEqual([r["reading_value"] for r in self.site.requests[0]["body"]], [3, 4, 5, 6, 7])

    def test_large_backlogs_go_in_batches(self):
        up = uploader(self.site, max_batch=4)
        for i in range(10):
            up.offer(reading(value=i))
        self.assertTrue(up.flush())
        self.assertEqual([len(r["body"]) for r in self.site.requests], [4, 4, 2])

    def test_two_flushes_at_once_send_every_reading_exactly_once(self):
        up = uploader(self.site, max_batch=5)
        for i in range(40):
            up.offer(reading(value=i))
        threads = [threading.Thread(target=up.flush) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        sent = [r["reading_value"] for req in self.site.requests for r in req["body"]]
        self.assertEqual(sorted(sent), list(range(40)))
        self.assertEqual(up.sent, 40)
        self.assertEqual(up.pending(), 0)

    def test_the_background_thread_sends_on_its_own(self):
        up = uploader(self.site, flush_seconds=0.2)
        up.start()
        try:
            up.offer(reading())
            deadline = time.time() + 5
            while not self.site.requests and time.time() < deadline:
                time.sleep(0.05)
        finally:
            up.stop()
        self.assertEqual(len(self.site.requests), 1)


# The three places in the gateway's pi_lora.py that the patch changes, as they are in the repo.
FIXTURE = """import psutil
import math

def main():
    try:
        pass
    except Exception:
        return

    legacy_topic = config.get('mqtt', {}).get('legacy_topic', 'ncar/iotwx/co/boulder/rp2040_test')

    while True:
        if packet is not None:
            try:
                if lora_msg.get('type') == 'sensor_data':
                    publish_legacy_format(mqtt_client, lora_msg, legacy_topic)

            except Exception as e:
                print(e)
"""


class PatchTests(unittest.TestCase):
    def run_patch(self, folder, *args):
        return subprocess.run(
            [sys.executable, str(HERE / "apply_to_pi_lora.py"), *args],
            cwd=folder, capture_output=True, text=True,
        )

    def test_patch_is_small_safe_and_repeatable(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "pi_lora.py").write_text(FIXTURE)
            (folder / "pi_config.json").write_text(json.dumps({"mqtt": {"broker_ip": "iotwx.ucar.edu"}}))
            (folder / "site_uploader.py").write_text((HERE / "site_uploader.py").read_text())

            check = self.run_patch(folder, "pi_lora.py", "--check")
            self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
            self.assertEqual((folder / "pi_lora.py").read_text(), FIXTURE)  # --check changes nothing

            done = self.run_patch(folder, "pi_lora.py", "--url", "http://192.168.0.2:8080/", "--key", "iotwx_" + "a" * 32)
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
            patched = (folder / "pi_lora.py").read_text()
            self.assertIn("from site_uploader import SiteUploader", patched)
            self.assertIn("    site = SiteUploader(config)\n    site.start()\n", patched)
            self.assertIn("                    publish_legacy_format(mqtt_client, lora_msg, legacy_topic)\n                site.offer(lora_msg)\n", patched)
            self.assertEqual((folder / "pi_lora.py.bak").read_text(), FIXTURE)  # the original is kept
            self.assertEqual(len(patched.splitlines()), len(FIXTURE.splitlines()) + 5)  # five added lines, nothing removed

            config = json.loads((folder / "pi_config.json").read_text())
            self.assertEqual(config["site"]["url"], "http://192.168.0.2:8080")
            self.assertEqual(config["site"]["api_key"], "iotwx_" + "a" * 32)
            self.assertEqual(config["mqtt"]["broker_ip"], "iotwx.ucar.edu")  # the NCAR settings are untouched

            again = self.run_patch(folder, "pi_lora.py")
            self.assertEqual(again.returncode, 0)
            self.assertEqual((folder / "pi_lora.py").read_text(), patched)  # a second run changes nothing

    def test_it_refuses_a_file_it_was_not_written_for(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "pi_lora.py").write_text("print('some other script')\n")
            (folder / "site_uploader.py").write_text("")
            result = self.run_patch(folder, "pi_lora.py")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((folder / "pi_lora.py").read_text(), "print('some other script')\n")

    def test_it_will_not_take_a_key_that_is_not_one(self):
        # "not-a-key" is wrong, and so is the example text people paste by mistake.
        for fake in ("not-a-key", "iotwx_YOUR_REAL_KEY", "iotwx_" + "a" * 31, "iotwx_" + "a" * 33):
            with tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                (folder / "pi_lora.py").write_text(FIXTURE)
                (folder / "site_uploader.py").write_text("")
                result = self.run_patch(folder, "pi_lora.py", "--url", "http://x", "--key", fake)
                self.assertNotEqual(result.returncode, 0, fake)
                self.assertIn("not a station key", result.stdout + result.stderr)
                self.assertEqual((folder / "pi_lora.py").read_text(), FIXTURE)  # nothing was changed

    def test_the_real_shape_of_a_key_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "pi_lora.py").write_text(FIXTURE)
            (folder / "site_uploader.py").write_text("")
            real = "iotwx_Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv"  # the shape a real key has
            result = self.run_patch(folder, "pi_lora.py", "--url", "http://x", "--key", real)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
