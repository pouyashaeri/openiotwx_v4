"""
Forecast runner loop. Polls the community server for queued runs on this backend, runs the
CREDIT pipeline for each (GFS init → realtime rollout → extract the nearest grid point per
station), posts the values to the API, pins the output on IPFS when a node is running, and
marks the run done. One run at a time; the website shows the queue.

BACKEND=local is this machine. BACKEND=boinc means this process is the project's assimilator:
tiles come back from volunteers and are stitched here. BACKEND=cirrus is the same image run
as a Kubernetes Job by the helm chart.
"""
from __future__ import annotations

import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from extract_station import extract_for_stations
from pin import pin

API_URL = os.environ.get("API_URL", "http://database_api:8000").rstrip("/")
BACKEND = os.environ.get("BACKEND", "local")
POLL = int(os.environ.get("POLL_SECONDS", "60"))
RESULTS = Path(os.environ.get("RESULTS_DIR", "/results"))
MODEL_YML = Path("/app/model.yml")
DEVICE = os.environ.get("DEVICE", "cpu")


# When this runner works for the OpenIoTwx website's own server (API_URL=https://<site>/hub), that
# server asks for HUB_TOKEN on writes. The standalone stack in this folder needs none.
HUB_TOKEN = os.environ.get("HUB_TOKEN", "")


def api(method: str, path: str, **kw):  # noqa: ANN003
    if HUB_TOKEN:
        kw["headers"] = {**kw.get("headers", {}), "x-hub-token": HUB_TOKEN}
    r = requests.request(method, f"{API_URL}{path}", timeout=60, **kw)
    r.raise_for_status()
    return r.json() if r.text else None


def mark(run_id: int, status: str, detail: str = "", cid: str = "", init_time: str = "") -> None:
    params = {"status": status, "detail": detail[:900], "cid": cid}
    if init_time:
        params["init_time"] = init_time
    api("PUT", f"/api/forecast-runs/{run_id}", params=params)


def configure(init: datetime, lead_hours: int, save: Path) -> None:
    """Write the run window and output path into model.yml the way credit.sh does with sed."""
    text = MODEL_YML.read_text()
    start = init.strftime("%Y-%m-%d %H:%M:%S")
    end = (init + timedelta(hours=lead_hours)).strftime("%Y-%m-%d %H:%M:%S")
    zarr = save / f"gfs_init_{init.strftime('%Y%m%d_%H%M')}.zarr"
    out = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("forecast_start_time:"):
            line = f'        forecast_start_time: "{start}"'
        elif s.startswith("forecast_end_time:"):
            line = f'        forecast_end_time: "{end}"'
        elif s.startswith("save_loc:") and s.endswith('.zarr"'):
            line = f'    save_loc: "{zarr}"'
        elif s.startswith("save_loc_surface:"):
            line = f'    save_loc_surface: "{zarr}"'
        elif s.startswith("save_loc:") and "results" in s and not s.endswith('.zarr"'):
            line = f"save_loc: '{save}'"
        out.append(line)
    MODEL_YML.write_text("\n".join(out) + "\n")


def run_pipeline(run: dict) -> tuple[Path, datetime]:
    init = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    init = init.replace(hour=(init.hour // 6) * 6)  # latest 6-hourly GFS cycle
    save = RESULTS / f"run_{run['id']}_{init.strftime('%Y%m%dT%HZ')}"
    save.mkdir(parents=True, exist_ok=True)
    configure(init, int(run["lead_hours"]), save)
    env = {**os.environ, "CUDA_VISIBLE_DEVICES": "" if DEVICE == "cpu" else os.environ.get("CUDA_VISIBLE_DEVICES", "0")}
    for script in ("applications/gfs_init.py", "applications/rollout_realtime.py"):
        subprocess.run(["python", f"/app/miles-credit/{script}", "-c", str(MODEL_YML)], check=True, env=env)
    return save, init


def process(run: dict) -> None:
    rid = run["id"]
    mark(rid, "running", f"Started on {BACKEND}")
    try:
        save, init = run_pipeline(run)
        stations = api("GET", "/api/stations/")
        if run.get("station_id"):
            stations = [s for s in stations if s["station_id"] == run["station_id"]] or [
                {"station_id": run["station_id"], "latitude": run["latitude"], "longitude": run["longitude"]}
            ]
        values = extract_for_stations(save, init, stations, run_id=rid)
        for i in range(0, len(values), 500):
            api("POST", "/api/credit-forecast/", json=values[i : i + 500])
        cid = pin(save) or ""
        mark(rid, "done", f"{len(values)} values for {len(stations)} station(s)", cid=cid, init_time=init.isoformat())
        print(f"[info] run {rid} done: {len(values)} values{', pinned ' + cid if cid else ''}")
    except subprocess.CalledProcessError as exc:
        mark(rid, "failed", f"CREDIT step failed: {exc}")
        print(f"[warn] run {rid} failed: {exc}")
    except Exception as exc:  # noqa: BLE001
        mark(rid, "failed", str(exc))
        print(f"[warn] run {rid} failed: {exc}")


if __name__ == "__main__":
    print(f"[info] credit runner on backend={BACKEND} device={DEVICE}, polling {API_URL} every {POLL}s")
    while True:
        try:
            queued = [r for r in api("GET", "/api/forecast-runs/", params={"status": "queued"}) if r["backend"] == BACKEND]
            for run in queued[:1]:
                process(run)
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] poll failed: {exc}")
        time.sleep(POLL)
