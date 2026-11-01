"""
Read the rollout output and pick the grid point nearest each station, the way siparcs25's
write_to_db.py did with its Excel export, but straight from the zarr/netCDF predictions.
Returns rows in the shape POST /api/credit-forecast/ accepts.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import numpy as np

VARIABLES = {"t2m": "t2m", "SP": "SP", "U500": "U500", "V500": "V500"}


def _open(path: Path):
    import xarray as xr

    preds = sorted(path.glob("**/pred_*")) or sorted(path.glob("**/*.nc")) or sorted(path.glob("**/*.zarr"))
    if not preds:
        raise FileNotFoundError(f"No prediction files under {path}")
    datasets = []
    for p in preds:
        datasets.append(xr.open_zarr(p) if p.suffix == ".zarr" or p.is_dir() else xr.open_dataset(p))
    return xr.concat(datasets, dim="time") if len(datasets) > 1 else datasets[0]


def extract_for_stations(path: Path, init: datetime, stations: list[dict], run_id: int | None = None) -> list[dict]:
    ds = _open(path)
    lat_name = "latitude" if "latitude" in ds.coords else "lat"
    lon_name = "longitude" if "longitude" in ds.coords else "lon"
    lons = ds[lon_name].values
    wrap = lons.max() > 180
    rows: list[dict] = []
    for s in stations:
        lat, lon = s.get("latitude"), s.get("longitude")
        if lat is None or lon is None:
            continue
        lon_q = lon % 360 if wrap else lon
        point = ds.sel({lat_name: lat, lon_name: lon_q}, method="nearest")
        for var in VARIABLES:
            if var not in point:
                continue
            series = point[var]
            if "level" in series.dims:
                series = series.isel(level=-1)
            for t, v in zip(series["time"].values, np.asarray(series.values).ravel()):
                if not np.isfinite(v):
                    continue
                rows.append({
                    "run_id": run_id,
                    "station_id": s["station_id"],
                    "variable": var,
                    "init_time": init.isoformat(),
                    "valid_time": str(np.datetime_as_string(t, unit="s")) + "+00:00",
                    "value": float(v),
                    "source": "credit",
                })
        # 10 m wind is not in this configuration; 500 hPa wind speed is kept as a proxy under wind10.
        if "U500" in point and "V500" in point:
            u, v = point["U500"], point["V500"]
            if "level" in u.dims:
                u, v = u.isel(level=-1), v.isel(level=-1)
            speed = np.sqrt(np.asarray(u.values) ** 2 + np.asarray(v.values) ** 2).ravel()
            for t, w in zip(u["time"].values, speed):
                rows.append({"run_id": run_id, "station_id": s["station_id"], "variable": "wind10", "init_time": init.isoformat(),
                             "valid_time": str(np.datetime_as_string(t, unit="s")) + "+00:00", "value": float(w), "source": "credit"})
    return rows
