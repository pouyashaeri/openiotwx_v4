"""
Place profile loader. For every station with coordinates, looks up the CDC/ATSDR SVI 2022
tract it sits in and the EJScreen indicators (EJAM API) for the one-mile buffer around it,
and stores both beside the readings so Metabase can join them. Runs once at start and then
every REFRESH_HOURS. Both sources are public; the station coordinate is the only thing sent.
"""
from __future__ import annotations

import os
import time

import requests

API_URL = os.environ.get("API_URL", "http://database_api:8000").rstrip("/")
EJAM_URL = os.environ.get("EJAM_URL", "https://api.ejanalysis.com").rstrip("/")
SVI_SERVICE = os.environ.get(
    "SVI_SERVICE",
    "https://services3.arcgis.com/ZvidGQkLaDJxRSJ2/ArcGIS/rest/services/CDC_ATSDR_Social_Vulnerability_Index_2022_USA/FeatureServer",
).rstrip("/")
SVI_TRACT_LAYER = 2
REFRESH_HOURS = float(os.environ.get("REFRESH_HOURS", "24"))
# Present this when the API is the OpenIoTwx website's own server (API_URL=https://<site>/hub).
HEADERS = {"x-hub-token": os.environ["HUB_TOKEN"]} if os.environ.get("HUB_TOKEN") else {}

SVI_FIELDS = ["FIPS", "LOCATION", "COUNTY", "ST_ABBR", "E_TOTPOP", "RPL_THEMES", "RPL_THEME1", "RPL_THEME2", "RPL_THEME3", "RPL_THEME4", "F_TOTAL"]
FACTORS = ["POV150", "UNEMP", "HBURD", "NOHSDP", "UNINSUR", "AGE65", "AGE17", "DISABL", "SNGPNT", "LIMENG", "MINRTY", "MUNIT", "MOBILE", "CROWD", "NOVEH", "GROUPQ"]
for f in FACTORS:
    SVI_FIELDS += [f"EP_{f}", f"EPL_{f}", f"F_{f}"]
SVI_FIELDS += ["E_NOINT", "EP_NOINT"]


def svi_for(lat: float, lon: float) -> dict | None:
    params = {
        "f": "json", "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "outFields": ",".join(SVI_FIELDS), "returnGeometry": "false",
    }
    r = requests.get(f"{SVI_SERVICE}/{SVI_TRACT_LAYER}/query", params=params, timeout=30)
    r.raise_for_status()
    feats = r.json().get("features") or []
    return feats[0]["attributes"] if feats else None


def ej_for(lat: float, lon: float, buffer: float = 1.0) -> dict | None:
    r = requests.post(f"{EJAM_URL}/data", json={"sites": [{"lat": lat, "lon": lon}], "buffer": buffer}, timeout=120)
    if r.status_code != 200 or r.text.lstrip().startswith("<"):
        return None
    data = r.json()
    return data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)


def refresh() -> None:
    stations = requests.get(f"{API_URL}/api/stations/", headers=HEADERS, timeout=15).json()
    for s in stations:
        lat, lon = s.get("latitude"), s.get("longitude")
        if lat is None or lon is None:
            continue
        sid = s["station_id"]
        try:
            attrs = svi_for(lat, lon)
            if attrs:
                requests.put(f"{API_URL}/api/place/svi", json={"station_id": sid, "attributes": attrs}, headers=HEADERS, timeout=15)
                print(f"[info] {sid}: SVI tract {attrs.get('FIPS')} overall {attrs.get('RPL_THEMES')}")
            else:
                print(f"[warn] {sid}: no SVI tract (outside the US?)")
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] {sid}: SVI failed: {exc}")
        try:
            row = ej_for(lat, lon)
            if row:
                requests.put(f"{API_URL}/api/place/ej/{sid}", json={"row": row, "buffer_miles": 1}, headers=HEADERS, timeout=15)
                print(f"[info] {sid}: EJScreen pm2.5 pctile {row.get('pctile.pm')}")
            else:
                print(f"[warn] {sid}: EJAM returned nothing")
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] {sid}: EJAM failed: {exc}")


if __name__ == "__main__":
    while True:
        try:
            refresh()
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] refresh failed: {exc}")
        time.sleep(REFRESH_HOURS * 3600)
