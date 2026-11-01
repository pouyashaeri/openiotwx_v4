"""
OpenIoTwx v3 community server.

A small FastAPI service over the community's own Postgres/Timescale database. It keeps the
route shapes of NCAR's mesonet-siparcs25 `database_api` (stations, readings, credit forecasts)
and adds what v3 needs: forecast runs, the build collective, place profiles, consent, and a
health report the website reads. Nothing here calls out except the optional EJAM proxy.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, Field

DATABASE_URL = os.environ["DATABASE_URL"]
CORS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
EJAM_URL = os.environ.get("EJAM_URL", "https://api.ejanalysis.com").rstrip("/")
BOINC_PROJECT_URL = os.environ.get("BOINC_PROJECT_URL", "")
BOINC_ACCOUNT_KEY = os.environ.get("BOINC_ACCOUNT_KEY", "")
CIRRUS_ENABLED = os.environ.get("CIRRUS_ENABLED", "0") == "1"
VERSION = os.environ.get("API_VERSION", "3.0.0")

pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=8, kwargs={"row_factory": dict_row}, open=False)
app = FastAPI(title="OpenIoTwx community server", version=VERSION)
app.add_middleware(CORSMiddleware, allow_origins=CORS or ["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _open_pool() -> None:
    pool.open()


def q(sql: str, params: tuple = (), one: bool = False, write: bool = False) -> Any:
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            if write:
                conn.commit()
            if cur.description is None:
                return None
            return cur.fetchone() if one else cur.fetchall()


# ---------- models ----------

class StationIn(BaseModel):
    station_id: str
    device: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    organization: Optional[str] = None
    steward: Optional[str] = None
    contact: Optional[str] = None
    topic: Optional[str] = None


class ReadingIn(BaseModel):
    station_id: str
    measurement: str
    reading_value: float
    sensor_model: Optional[str] = None
    sensor_protocol: Optional[str] = None
    edge_id: Optional[str] = None
    rssi: Optional[int] = None
    timestamp: Optional[datetime] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ForecastRunIn(BaseModel):
    latitude: float
    longitude: float
    lead_hours: int = Field(default=48, ge=6, le=240)
    backend: str = "local"
    station_id: Optional[str] = None


class ForecastValueIn(BaseModel):
    run_id: Optional[int] = None
    station_id: str
    variable: str
    init_time: datetime
    valid_time: datetime
    value: float
    source: str = "credit"


class MemberIn(BaseModel):
    name: str
    contact: str = ""
    area: str = ""
    offers: list[str] = []
    printers: str = ""
    notes: str = ""


class InventoryIn(BaseModel):
    station_label: str
    part_id: str
    status: str = "queued"
    owner: str = ""


class ConsentIn(BaseModel):
    station_id: str
    steward: str
    contact: str = ""
    scope: str = "local"
    gdex: bool = False
    license: str = "CC BY 4.0"


# ---------- health ----------

@app.get("/health")
def health() -> dict:
    services = {"database": False, "boinc": bool(BOINC_PROJECT_URL), "cirrus": CIRRUS_ENABLED}
    try:
        q("SELECT 1", one=True)
        services["database"] = True
    except Exception:  # noqa: BLE001
        pass
    return {"status": "ok" if services["database"] else "degraded", "version": VERSION, "services": services}


# ---------- stations and readings (siparcs25-compatible) ----------

@app.get("/api/stations/")
def stations() -> list[dict]:
    return q("SELECT * FROM stations ORDER BY last_active DESC")


@app.get("/api/stations/{station_id}")
def station(station_id: str) -> dict:
    row = q("SELECT * FROM stations WHERE station_id = %s", (station_id,), one=True)
    if not row:
        raise HTTPException(404, "No such station")
    return row


@app.post("/api/stations/")
def upsert_station(body: StationIn) -> dict:
    return q(
        """
        INSERT INTO stations (station_id, device, latitude, longitude, altitude, organization, steward, contact, topic)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (station_id) DO UPDATE SET
          device = COALESCE(EXCLUDED.device, stations.device),
          latitude = COALESCE(EXCLUDED.latitude, stations.latitude),
          longitude = COALESCE(EXCLUDED.longitude, stations.longitude),
          altitude = COALESCE(EXCLUDED.altitude, stations.altitude),
          organization = COALESCE(EXCLUDED.organization, stations.organization),
          steward = COALESCE(EXCLUDED.steward, stations.steward),
          contact = COALESCE(EXCLUDED.contact, stations.contact),
          topic = COALESCE(EXCLUDED.topic, stations.topic),
          last_active = now()
        RETURNING *
        """,
        (body.station_id, body.device, body.latitude, body.longitude, body.altitude, body.organization, body.steward, body.contact, body.topic),
        one=True,
        write=True,
    )


@app.get("/api/readings/{station_id}")
def readings(station_id: str, hours: int = Query(default=72, ge=1, le=24 * 90)) -> list[dict]:
    rows = q(
        """
        SELECT station_id, measurement, reading_value, sensor_model, time AS timestamp
        FROM readings
        WHERE station_id = %s AND time > now() - (%s || ' hours')::interval
        ORDER BY time ASC
        """,
        (station_id, hours),
    )
    return rows


@app.post("/api/readings/")
def add_reading(body: ReadingIn) -> dict:
    q(
        """
        INSERT INTO stations (station_id, latitude, longitude) VALUES (%s,%s,%s)
        ON CONFLICT (station_id) DO UPDATE SET
          last_active = now(),
          latitude = COALESCE(EXCLUDED.latitude, stations.latitude),
          longitude = COALESCE(EXCLUDED.longitude, stations.longitude)
        """,
        (body.station_id, body.latitude, body.longitude),
        write=True,
    )
    row = q(
        """
        INSERT INTO readings (time, station_id, measurement, reading_value, sensor_model, sensor_protocol, edge_id, rssi)
        VALUES (COALESCE(%s, now()), %s, %s, %s, %s, %s, %s, %s)
        RETURNING time AS timestamp, station_id, measurement, reading_value, sensor_model
        """,
        (body.timestamp, body.station_id, body.measurement, body.reading_value, body.sensor_model, body.sensor_protocol, body.edge_id, body.rssi),
        one=True,
        write=True,
    )
    return row


@app.get("/api/latest/{station_id}")
def latest(station_id: str) -> list[dict]:
    return q("SELECT measurement, reading_value, time FROM latest_readings WHERE station_id = %s", (station_id,))


# ---------- forecasts ----------

@app.get("/api/credit-forecast/{station_id}/")
def credit_forecast(station_id: str) -> list[dict]:
    """Latest run's values for the station, shaped like siparcs25 plus init_time and source."""
    return q(
        """
        WITH latest AS (
          SELECT max(init_time) AS init_time FROM credit_forecasts WHERE station_id = %s
        )
        SELECT station_id, variable, valid_time, value, init_time, source
        FROM credit_forecasts, latest
        WHERE station_id = %s AND credit_forecasts.init_time = latest.init_time
        ORDER BY variable, valid_time
        """,
        (station_id, station_id),
    )


@app.post("/api/credit-forecast/")
def add_forecast_values(body: list[ForecastValueIn]) -> dict:
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO credit_forecasts (run_id, station_id, variable, init_time, valid_time, value, source)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (station_id, variable, init_time, valid_time, source) DO UPDATE SET value = EXCLUDED.value, run_id = EXCLUDED.run_id
                """,
                [(v.run_id, v.station_id, v.variable, v.init_time, v.valid_time, v.value, v.source) for v in body],
            )
        conn.commit()
    return {"inserted": len(body)}


@app.get("/api/forecast-runs/")
def forecast_runs(status: Optional[str] = None) -> list[dict]:
    if status:
        return q("SELECT * FROM forecast_runs WHERE status = %s ORDER BY created_at ASC", (status,))
    return q("SELECT * FROM forecast_runs ORDER BY created_at DESC LIMIT 50")


@app.post("/api/forecast-runs/")
def request_run(body: ForecastRunIn) -> dict:
    if body.backend not in ("local", "boinc", "cirrus"):
        raise HTTPException(400, "backend must be local, boinc, or cirrus")
    if body.backend == "cirrus" and not CIRRUS_ENABLED:
        raise HTTPException(409, "CIRRUS is not enabled on this server. Set CIRRUS_ENABLED=1 once the helm release is up.")
    if body.backend == "boinc" and not BOINC_PROJECT_URL:
        raise HTTPException(409, "No BOINC project configured. Set BOINC_PROJECT_URL in .env.")
    return q(
        """
        INSERT INTO forecast_runs (station_id, latitude, longitude, lead_hours, backend)
        VALUES (%s,%s,%s,%s,%s) RETURNING *
        """,
        (body.station_id, body.latitude, body.longitude, body.lead_hours, body.backend),
        one=True,
        write=True,
    )


@app.put("/api/forecast-runs/{run_id}")
def update_run(run_id: int, status: str, detail: str = "", cid: str = "", init_time: Optional[datetime] = None) -> dict:
    row = q(
        """
        UPDATE forecast_runs SET status = %s, detail = NULLIF(%s,''), cid = COALESCE(NULLIF(%s,''), cid),
               init_time = COALESCE(%s, init_time), updated_at = now()
        WHERE id = %s RETURNING *
        """,
        (status, detail, cid, init_time, run_id),
        one=True,
        write=True,
    )
    if not row:
        raise HTTPException(404, "No such run")
    return row


@app.get("/api/compute/status")
def compute_status() -> list[dict]:
    queued = q("SELECT backend, count(*) AS n FROM forecast_runs WHERE status IN ('queued','running') GROUP BY backend")
    counts = {r["backend"]: r["n"] for r in queued}
    local_seen = q("SELECT max(updated_at) AS t FROM forecast_runs WHERE backend = 'local' AND status IN ('done','running')", one=True)
    local_alive = bool(local_seen and local_seen["t"] and (datetime.now(timezone.utc) - local_seen["t"]).total_seconds() < 6 * 3600)
    return [
        {"backend": "local", "available": local_alive, "queued": counts.get("local", 0),
         "detail": "The credit_runner service has reported recently." if local_alive else "No run reported in the last six hours. Start it with --profile forecast."},
        {"backend": "boinc", "available": bool(BOINC_PROJECT_URL), "queued": counts.get("boinc", 0),
         "detail": f"Project {BOINC_PROJECT_URL}" if BOINC_PROJECT_URL else "No BOINC project configured yet.",
         **({"volunteers": _boinc_volunteers()} if BOINC_PROJECT_URL else {})},
        {"backend": "cirrus", "available": CIRRUS_ENABLED, "queued": counts.get("cirrus", 0),
         "detail": "CIRRUS helm release accepts runs." if CIRRUS_ENABLED else "Not enabled. See infra/helm."},
    ]


@app.get("/api/compute/boinc")
def boinc_info() -> dict:
    """What a volunteer needs to attach. The account key is shared by the steward, not public."""
    return {"project_url": BOINC_PROJECT_URL, "has_key": bool(BOINC_ACCOUNT_KEY)}


def _boinc_volunteers() -> int:
    """Hosts that fetched work in the last day, if the project server exposes server_status.php."""
    if not BOINC_PROJECT_URL:
        return 0
    try:
        r = httpx.get(f"{BOINC_PROJECT_URL.rstrip('/')}/server_status.php?xml=1", timeout=4)
        if r.status_code == 200 and "<users_with_recent_credit>" in r.text:
            return int(r.text.split("<users_with_recent_credit>")[1].split("<")[0])
    except Exception:  # noqa: BLE001
        pass
    return 0


# ---------- place profile ----------

@app.get("/api/place/ej")
def ej_proxy(lat: float, lon: float, buffer: float = 1.0) -> dict:
    """Proxy for the EJAM API, for browsers that cannot call it directly. Slow (up to a minute)."""
    try:
        r = httpx.post(f"{EJAM_URL}/data", json={"sites": [{"lat": lat, "lon": lon}], "buffer": buffer}, timeout=90)
        r.raise_for_status()
        data = r.json()
        return data[0] if isinstance(data, list) and data else data
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"EJAM did not answer: {exc}") from exc


@app.get("/api/place/{station_id}")
def place(station_id: str) -> dict:
    row = q("SELECT * FROM station_context WHERE station_id = %s", (station_id,), one=True)
    if not row:
        raise HTTPException(404, "No such station")
    return row


@app.put("/api/place/svi")
def put_svi(body: dict) -> dict:
    attrs = body.get("attributes") or body
    fips = str(attrs.get("FIPS", ""))
    if not fips:
        raise HTTPException(400, "FIPS required")
    q(
        """
        INSERT INTO svi_tracts (fips, location, county, state, population, rpl_themes, rpl_theme1, rpl_theme2, rpl_theme3, rpl_theme4, f_total, attributes, fetched_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
        ON CONFLICT (fips) DO UPDATE SET location=EXCLUDED.location, county=EXCLUDED.county, state=EXCLUDED.state, population=EXCLUDED.population,
          rpl_themes=EXCLUDED.rpl_themes, rpl_theme1=EXCLUDED.rpl_theme1, rpl_theme2=EXCLUDED.rpl_theme2, rpl_theme3=EXCLUDED.rpl_theme3,
          rpl_theme4=EXCLUDED.rpl_theme4, f_total=EXCLUDED.f_total, attributes=EXCLUDED.attributes, fetched_at=now()
        """,
        (fips, attrs.get("LOCATION"), attrs.get("COUNTY"), attrs.get("ST_ABBR"), attrs.get("E_TOTPOP"), attrs.get("RPL_THEMES"),
         attrs.get("RPL_THEME1"), attrs.get("RPL_THEME2"), attrs.get("RPL_THEME3"), attrs.get("RPL_THEME4"), attrs.get("F_TOTAL"), json.dumps(attrs)),
        write=True,
    )
    station_id = body.get("station_id")
    if station_id:
        q("UPDATE stations SET tract_fips = %s WHERE station_id = %s", (fips, station_id), write=True)
    return {"fips": fips}


@app.put("/api/place/ej/{station_id}")
def put_ej(station_id: str, body: dict) -> dict:
    row = body.get("row") or body
    def f(key: str) -> Optional[float]:
        v = row.get(key)
        try:
            return float(v) if v not in (None, "") else None
        except (TypeError, ValueError):
            return None
    report = row.get("EJAM Report") if isinstance(row.get("EJAM Report"), str) else None
    q(
        """
        INSERT INTO ej_indicators (station_id, buffer_miles, population, demog_index_pctile, supp_demog_index_pctile, pm25, pm25_pctile, ozone, ozone_pctile,
          no2_pctile, dpm_pctile, traffic_pctile, lowinc_pct, minority_pct, over64_pct, under5_pct, row_json, report_url, fetched_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
        ON CONFLICT (station_id) DO UPDATE SET buffer_miles=EXCLUDED.buffer_miles, population=EXCLUDED.population,
          demog_index_pctile=EXCLUDED.demog_index_pctile, supp_demog_index_pctile=EXCLUDED.supp_demog_index_pctile, pm25=EXCLUDED.pm25,
          pm25_pctile=EXCLUDED.pm25_pctile, ozone=EXCLUDED.ozone, ozone_pctile=EXCLUDED.ozone_pctile, no2_pctile=EXCLUDED.no2_pctile,
          dpm_pctile=EXCLUDED.dpm_pctile, traffic_pctile=EXCLUDED.traffic_pctile, lowinc_pct=EXCLUDED.lowinc_pct, minority_pct=EXCLUDED.minority_pct,
          over64_pct=EXCLUDED.over64_pct, under5_pct=EXCLUDED.under5_pct, row_json=EXCLUDED.row_json, report_url=EXCLUDED.report_url, fetched_at=now()
        """,
        (station_id, body.get("buffer_miles", 1), f("pop"), f("pctile.Demog.Index"), f("pctile.Demog.Index.Supp"), f("pm"), f("pctile.pm"), f("o3"),
         f("pctile.o3"), f("pctile.no2"), f("pctile.dpm"), f("pctile.traffic.score"), f("pctlowinc"), f("pctmin"), f("pctover64"), f("pctunder5"),
         json.dumps(row), report),
        write=True,
    )
    return {"station_id": station_id}


# ---------- build collective ----------

@app.get("/api/collective/members/")
def members() -> list[dict]:
    return q("SELECT * FROM collective_members ORDER BY created_at DESC LIMIT 200")


@app.post("/api/collective/members/")
def join(body: MemberIn) -> dict:
    return q(
        "INSERT INTO collective_members (name, contact, area, offers, printers, notes) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
        (body.name, body.contact, body.area, body.offers, body.printers, body.notes),
        one=True,
        write=True,
    )


@app.get("/api/collective/inventory/")
def inventory() -> list[dict]:
    return q("SELECT * FROM collective_inventory ORDER BY station_label, part_id")


@app.put("/api/collective/inventory/")
def save_inventory(body: list[InventoryIn]) -> list[dict]:
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO collective_inventory (station_label, part_id, status, owner, updated_at)
                VALUES (%s,%s,%s,%s,now())
                ON CONFLICT (station_label, part_id) DO UPDATE SET status = EXCLUDED.status, owner = EXCLUDED.owner, updated_at = now()
                """,
                [(i.station_label, i.part_id, i.status, i.owner) for i in body],
            )
        conn.commit()
    return inventory()


# ---------- consent ----------

@app.get("/api/consent/")
def consents() -> list[dict]:
    return q("SELECT DISTINCT ON (station_id) * FROM data_consent ORDER BY station_id, recorded_at DESC")


@app.post("/api/consent/")
def record_consent(body: ConsentIn) -> dict:
    if body.scope not in ("local", "community", "open"):
        raise HTTPException(400, "scope must be local, community, or open")
    return q(
        "INSERT INTO data_consent (station_id, steward, contact, scope, gdex, license) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
        (body.station_id, body.steward, body.contact, body.scope, body.gdex, body.license),
        one=True,
        write=True,
    )


@app.get("/api/publications/")
def publications() -> list[dict]:
    return q("SELECT * FROM gdex_publications ORDER BY created_at DESC LIMIT 100")
