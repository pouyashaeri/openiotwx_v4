"""BOINC work generator daemon: turns queued `backend = boinc` forecast runs into tiles.
Run from the project directory: bin/start registers it via config.xml <daemon>."""
from __future__ import annotations

import json
import os
import subprocess
import time

import requests

API_URL = os.environ.get("API_URL", "http://database_api:8000").rstrip("/")
TILE_DEG = 10
LEAD_WINDOW = 24


def tiles_for(run: dict) -> list[dict]:
    lat, lon = run["latitude"], run["longitude"]
    box = [lat - TILE_DEG / 2, lat + TILE_DEG / 2, lon - TILE_DEG / 2, lon + TILE_DEG / 2]
    return [{"run_id": run["id"], "bounds": box, "lead_start": h, "lead_hours": min(LEAD_WINDOW, run["lead_hours"] - h)}
            for h in range(0, run["lead_hours"], LEAD_WINDOW)]


def create_work(tile: dict) -> None:
    name = f"credit_tile_{tile['run_id']}_{tile['lead_start']:03d}"
    with open(f"../download/{name}.json", "w") as fh:
        json.dump(tile, fh)
    subprocess.run(["bin/create_work", "--appname", "credit_tile", "--wu_name", name, "--wu_template", "templates/credit_tile_in",
                    "--result_template", "templates/credit_tile_out", "--min_quorum", "2", "--target_nresults", "2",
                    f"{name}.json", "gfs_init.nc", "checkpoint.pt"], check=True)


if __name__ == "__main__":
    while True:
        try:
            for run in requests.get(f"{API_URL}/api/forecast-runs/", params={"status": "queued"}, timeout=30).json():
                if run["backend"] != "boinc":
                    continue
                for tile in tiles_for(run):
                    create_work(tile)
                requests.put(f"{API_URL}/api/forecast-runs/{run['id']}", params={"status": "running", "detail": "tiles issued to volunteers"}, timeout=30)
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] {exc}")
        time.sleep(60)
