"""BOINC assimilator: called with the canonical result of each validated tile. When every tile
of a run has arrived, concatenate them, extract the nearest grid point per station, post the
values to the community API, pin the bundle on IPFS, and mark the run done."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, os.path.dirname(__file__))
from extract_station import extract_for_stations  # copy of services/credit_runner/extract_station.py
from pin import pin                                 # copy of services/pinner/pin.py

API_URL = os.environ.get("API_URL", "http://database_api:8000").rstrip("/")
RESULTS = Path(os.environ.get("RESULTS_DIR", "/results/boinc"))


def assimilate(run_id: int, tile_path: Path, lead_start: int) -> None:
    dest = RESULTS / f"run_{run_id}"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"pred_{lead_start:03d}.nc").write_bytes(tile_path.read_bytes())
    run = next(r for r in requests.get(f"{API_URL}/api/forecast-runs/", timeout=30).json() if r["id"] == run_id)
    expected = -(-run["lead_hours"] // 24)
    if len(list(dest.glob("pred_*.nc"))) < expected:
        return
    init = datetime.now(timezone.utc)
    stations = requests.get(f"{API_URL}/api/stations/", timeout=30).json()
    values = extract_for_stations(dest, init, stations, run_id=run_id)
    for i in range(0, len(values), 500):
        requests.post(f"{API_URL}/api/credit-forecast/", json=values[i : i + 500], timeout=60)
    cid = pin(dest) or ""
    requests.put(f"{API_URL}/api/forecast-runs/{run_id}", params={"status": "done", "detail": f"{expected} tiles from volunteers", "cid": cid, "init_time": init.isoformat()}, timeout=30)


if __name__ == "__main__":
    # BOINC passes: <wu_name> <canonical result file>
    wu_name, result = sys.argv[1], Path(sys.argv[2])
    _, _, run_id, lead = wu_name.split("_")
    assimilate(int(run_id), result, int(lead))
