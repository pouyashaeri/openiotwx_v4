"""
GDEX publisher. Once a day, for every station whose latest consent row has gdex = true, it
packages the previous month (CF-1.8 NetCDF + Parquet + a JSON metadata record), writes it to
EXPORT_DIR so a person can open it, pins it on IPFS when a node is running, and, unless
DRY_RUN=1, uploads it to the GDEX collection the team assigned.

No consent row, or gdex = false, means the station is skipped. Always.

GDEX (https://gdex.ucar.edu/) assigns collections through its data submission process; the
README has the request template. GDEX_ENDPOINT/GDEX_TOKEN come from that assignment.
"""
from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import psycopg
import requests
import xarray as xr

from pin import pin

DATABASE_URL = os.environ["DATABASE_URL"]
EXPORT_DIR = Path(os.environ.get("EXPORT_DIR", "/exports"))
GDEX_ENDPOINT = os.environ.get("GDEX_ENDPOINT", "").rstrip("/")
GDEX_TOKEN = os.environ.get("GDEX_TOKEN", "")
GDEX_COLLECTION = os.environ.get("GDEX_COLLECTION", "")
DRY_RUN = os.environ.get("DRY_RUN", "1") == "1"
SCHEDULE_HOURS = float(os.environ.get("SCHEDULE_HOURS", "24"))

CF = {
    "temperature": ("air_temperature", "degC"), "humidity": ("relative_humidity", "percent"), "pressure": ("air_pressure", "hPa"),
    "wind_speed": ("wind_speed", "m s-1"), "wind_direction": ("wind_from_direction", "degree"), "rain": ("rainfall_rate", "mm h-1"),
    "pm25": ("mass_concentration_of_pm2p5_ambient_aerosol_particles_in_air", "ug m-3"), "co2": ("mole_fraction_of_carbon_dioxide_in_air", "ppm"),
    "ozone": ("mole_fraction_of_ozone_in_air", "ppb"), "uv": ("ultraviolet_index", "1"), "light": ("downwelling_shortwave_flux_in_air", "lux"),
    "soil_moisture": ("volume_fraction_of_condensed_water_in_soil", "percent"),
}


def consented(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT DISTINCT ON (c.station_id) c.station_id, c.steward, c.contact, c.scope, c.gdex, c.license, c.recorded_at,
               s.latitude, s.longitude, s.altitude, s.organization
        FROM data_consent c JOIN stations s ON s.station_id = c.station_id
        ORDER BY c.station_id, c.recorded_at DESC
        """
    ).fetchall()
    cols = ["station_id", "steward", "contact", "scope", "gdex", "license", "recorded_at", "latitude", "longitude", "altitude", "organization"]
    return [dict(zip(cols, r)) for r in rows if r[4]]


def month_window(today: date) -> tuple[date, date]:
    first_this = today.replace(day=1)
    last_prev = first_this - timedelta(days=1)
    return last_prev.replace(day=1), first_this


def package(conn, station: dict, start: date, end: date) -> Path | None:
    df = pd.read_sql(
        "SELECT time, measurement, reading_value FROM readings WHERE station_id = %s AND time >= %s AND time < %s ORDER BY time",
        conn, params=(station["station_id"], start, end),
    )
    if df.empty:
        return None
    sid = station["station_id"]
    out = EXPORT_DIR / sid / f"{start:%Y-%m}"
    out.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out / f"{sid}_{start:%Y%m}.parquet", index=False)
    wide = df.pivot_table(index="time", columns="measurement", values="reading_value", aggfunc="mean").sort_index()
    ds = xr.Dataset({m: ("time", wide[m].values) for m in wide.columns}, coords={"time": wide.index.values})
    for m in wide.columns:
        std, unit = CF.get(m, (m, "1"))
        ds[m].attrs.update({"standard_name": std, "units": unit, "long_name": m.replace("_", " ")})
    ds = ds.assign_coords(latitude=round(float(station["latitude"] or 0), 3), longitude=round(float(station["longitude"] or 0), 3))
    ds.attrs.update({
        "Conventions": "CF-1.8", "title": f"OpenIoTwx community station {sid}, {start:%B %Y}",
        "institution": station.get("organization") or "OpenIoTwx community", "source": "OpenIoTwx 3D-printed weather station",
        "license": station["license"], "creator_name": station["steward"], "creator_email": station.get("contact") or "",
        "history": f"Packaged {datetime.now(timezone.utc).isoformat()} by openiotwx gdex_publisher",
        "comment": "Location rounded to ~100 m. No personal data. Consent recorded " + str(station["recorded_at"]),
    })
    ds.to_netcdf(out / f"{sid}_{start:%Y%m}.nc")
    meta = {
        "dataset": ds.attrs["title"], "station_id": sid, "period": [str(start), str(end)], "variables": list(wide.columns),
        "samples": int(len(df)), "license": station["license"], "steward": station["steward"], "contact": station.get("contact") or "",
        "latitude": ds.latitude.item(), "longitude": ds.longitude.item(), "consent_recorded_at": str(station["recorded_at"]),
        "scope": station["scope"], "format": ["netcdf", "parquet"], "collection": GDEX_COLLECTION,
    }
    (out / "metadata.json").write_text(json.dumps(meta, indent=2))
    return out


def upload(folder: Path) -> tuple[str, str]:
    if DRY_RUN or not GDEX_ENDPOINT:
        return "dry-run", "Package written; set GDEX_DRY_RUN=0 and GDEX_ENDPOINT to upload."
    try:
        for f in folder.iterdir():
            with f.open("rb") as fh:
                r = requests.post(f"{GDEX_ENDPOINT}/collections/{GDEX_COLLECTION}/files", files={"file": (f.name, fh)},
                                  headers={"Authorization": f"Bearer {GDEX_TOKEN}"}, timeout=600)
                r.raise_for_status()
        return "uploaded", f"{len(list(folder.iterdir()))} files sent to {GDEX_COLLECTION}"
    except Exception as exc:  # noqa: BLE001
        return "failed", str(exc)[:900]


def run_once() -> None:
    start, end = month_window(date.today())
    with psycopg.connect(DATABASE_URL) as conn:
        for station in consented(conn):
            sid = station["station_id"]
            done = conn.execute("SELECT status FROM gdex_publications WHERE station_id=%s AND period_start=%s AND period_end=%s", (sid, start, end)).fetchone()
            if done and done[0] == "uploaded":
                continue
            folder = package(conn, station, start, end)
            if folder is None:
                print(f"[info] {sid}: no readings for {start:%Y-%m}")
                continue
            cid = pin(folder) or None
            status, detail = upload(folder)
            conn.execute(
                """
                INSERT INTO gdex_publications (station_id, period_start, period_end, package_path, cid, status, detail)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (station_id, period_start, period_end) DO UPDATE SET package_path=EXCLUDED.package_path, cid=EXCLUDED.cid, status=EXCLUDED.status, detail=EXCLUDED.detail
                """,
                (sid, start, end, str(folder), cid, status, detail),
            )
            conn.commit()
            print(f"[info] {sid}: {status} ({detail})")


if __name__ == "__main__":
    while True:
        try:
            run_once()
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] publish cycle failed: {exc}")
        time.sleep(SCHEDULE_HOURS * 3600)
