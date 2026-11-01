"""Pin a file or folder on the community's IPFS (kubo) node and return its CID. Shared by the
forecast runner and the GDEX publisher. Silent when IPFS is not running."""
from __future__ import annotations

import os
from pathlib import Path

import requests


def pin(path: str | Path, api: str | None = None) -> str | None:
    api = (api or os.environ.get("IPFS_API", "http://ipfs:5001")).rstrip("/")
    path = Path(path)
    try:
        if path.is_dir():
            files = [("file", (str(p.relative_to(path.parent)), p.open("rb"))) for p in path.rglob("*") if p.is_file()]
            r = requests.post(f"{api}/api/v0/add?wrap-with-directory=false&pin=true&recursive=true", files=files, timeout=300)
            for f in files:
                f[1][1].close()
            last = [line for line in r.text.strip().splitlines() if line.strip()][-1]
            return requests.compat.json.loads(last)["Hash"]
        with path.open("rb") as fh:
            r = requests.post(f"{api}/api/v0/add?pin=true", files={"file": fh}, timeout=300)
        return r.json()["Hash"]
    except Exception as exc:  # noqa: BLE001
        print(f"[info] not pinned ({exc})")
        return None
