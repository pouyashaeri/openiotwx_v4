"""
Metabase orchestrator. Mirrors mesonet-siparcs25's metabase service in spirit: it finishes
Metabase's first-run setup, connects the community database, and builds a collection per
station with the saved questions in questions.sql plus a dashboard. It re-runs every
RESYNC_MINUTES so new stations get their own collection without anyone clicking.
"""
from __future__ import annotations

import os
import re
import time

import requests

MB = os.environ.get("METABASE_URL", "http://metabase:3000").rstrip("/")
ADMIN_EMAIL = os.environ["MB_ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["MB_ADMIN_PASSWORD"]
SITE_NAME = os.environ.get("MB_SITE_NAME", "OpenIoTwx community portal")
DB = {"host": os.environ.get("DB_HOST", "postgres"), "port": 5432, "dbname": os.environ["DB_NAME"], "user": os.environ["DB_USER"], "password": os.environ["DB_PASSWORD"], "ssl": False}
API_URL = os.environ.get("API_URL", "http://database_api:8000").rstrip("/")
RESYNC = float(os.environ.get("RESYNC_MINUTES", "30"))

session = requests.Session()


def wait_for_metabase() -> None:
    for _ in range(120):
        try:
            if session.get(f"{MB}/api/health", timeout=5).json().get("status") == "ok":
                return
        except Exception:  # noqa: BLE001
            pass
        time.sleep(5)
    raise RuntimeError("Metabase never became healthy")


def login() -> int:
    props = session.get(f"{MB}/api/session/properties", timeout=15).json()
    token = props.get("setup-token")
    if token:
        r = session.post(f"{MB}/api/setup", json={
            "token": token,
            "user": {"first_name": "Community", "last_name": "Steward", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "site_name": SITE_NAME},
            "prefs": {"site_name": SITE_NAME, "allow_tracking": False},
            "database": {"engine": "postgres", "name": "iotwx", "details": DB, "is_full_sync": True},
        }, timeout=60)
        r.raise_for_status()
        session.headers["X-Metabase-Session"] = r.json()["id"]
        print("[info] Metabase set up; admin created")
    else:
        r = session.post(f"{MB}/api/session", json={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        r.raise_for_status()
        session.headers["X-Metabase-Session"] = r.json()["id"]
    session.put(f"{MB}/api/setting/enable-public-sharing", json={"value": True}, timeout=15)
    dbs = session.get(f"{MB}/api/database", timeout=15).json()
    dbs = dbs.get("data", dbs)
    for d in dbs:
        if d.get("name") == "iotwx":
            return d["id"]
    r = session.post(f"{MB}/api/database", json={"engine": "postgres", "name": "iotwx", "details": DB, "is_full_sync": True}, timeout=60)
    r.raise_for_status()
    return r.json()["id"]


def questions() -> list[dict]:
    text = open("/app/questions.sql", encoding="utf-8").read()
    out = []
    for block in re.split(r"\n(?=-- name:)", text):
        m = re.search(r"-- name: (.+)", block)
        if not m:
            continue
        display = re.search(r"-- display: (\w+)", block)
        coll = re.search(r"-- collection: (.+)", block)
        sql = "\n".join(l for l in block.splitlines() if not l.startswith("--")).strip()
        out.append({"name": m.group(1).strip(), "display": display.group(1) if display else "table", "collection": coll.group(1).strip() if coll else "Station overview", "sql": sql})
    return out


def collection(name: str, parent: int | None = None) -> int:
    items = session.get(f"{MB}/api/collection", timeout=15).json()
    for c in items:
        if c.get("name") == name and (c.get("location") == (f"/{parent}/" if parent else "/")):
            return c["id"]
    r = session.post(f"{MB}/api/collection", json={"name": name, "color": "#1649c9", "parent_id": parent}, timeout=15)
    r.raise_for_status()
    return r.json()["id"]


def card(db_id: int, coll_id: int, q: dict, station_id: str) -> int:
    existing = session.get(f"{MB}/api/card", params={"f": "all"}, timeout=30).json()
    for c in existing:
        if c.get("name") == q["name"] and c.get("collection_id") == coll_id:
            return c["id"]
    template = {"station_id": {"id": "station_id", "name": "station_id", "display-name": "Station", "type": "text", "default": station_id}}
    r = session.post(f"{MB}/api/card", json={
        "name": q["name"], "display": q["display"], "visualization_settings": {}, "collection_id": coll_id,
        "dataset_query": {"type": "native", "database": db_id, "native": {"query": q["sql"], "template-tags": template}},
    }, timeout=30)
    r.raise_for_status()
    return r.json()["id"]


def dashboard(coll_id: int, name: str, card_ids: list[int]) -> str | None:
    existing = session.get(f"{MB}/api/dashboard", timeout=30).json()
    dash = next((d for d in existing if d.get("name") == name and d.get("collection_id") == coll_id), None)
    if not dash:
        r = session.post(f"{MB}/api/dashboard", json={"name": name, "collection_id": coll_id}, timeout=30)
        r.raise_for_status()
        dash = r.json()
        cards = []
        for i, cid in enumerate(card_ids):
            cards.append({"id": -(i + 1), "card_id": cid, "row": (i // 2) * 6, "col": (i % 2) * 12, "size_x": 12, "size_y": 6})
        session.put(f"{MB}/api/dashboard/{dash['id']}", json={"dashcards": cards}, timeout=30)
    r = session.post(f"{MB}/api/dashboard/{dash['id']}/public_link", timeout=15)
    if r.status_code == 200:
        return f"{MB}/public/dashboard/{r.json()['uuid']}"
    return None


def sync(db_id: int) -> None:
    root = collection("OpenIoTwx")
    toolkit = collection("Decision toolkit", root)
    stations = requests.get(f"{API_URL}/api/stations/", timeout=15).json()
    qs = questions()
    for s in stations:
        sid = s["station_id"]
        coll = collection(sid, root)
        overview_cards = [card(db_id, coll, q, sid) for q in qs if q["collection"] == "Station overview"]
        toolkit_cards = [card(db_id, toolkit, {**q, "name": f"{q['name']} · {sid}"}, sid) for q in qs if q["collection"] == "Decision toolkit"]
        link = dashboard(coll, f"{sid} overview", overview_cards + toolkit_cards)
        print(f"[info] {sid}: {len(overview_cards) + len(toolkit_cards)} questions; dashboard {link or 'private'}")


if __name__ == "__main__":
    wait_for_metabase()
    db_id = login()
    print(f"[info] connected database id {db_id}")
    while True:
        try:
            sync(db_id)
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] sync failed: {exc}")
            try:
                db_id = login()
            except Exception:  # noqa: BLE001
                pass
        time.sleep(RESYNC * 60)
