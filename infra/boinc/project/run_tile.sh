#!/usr/bin/env bash
# Runs inside the BOINC wrapper on a volunteer machine. Inputs arrive as job files; the output
# prediction.nc is uploaded when the script exits 0. Python and miles-credit are shipped with
# the app version (a conda-pack tarball) so volunteers install nothing but the BOINC client.
set -euo pipefail
TILE=tile.json; INIT=gfs_init.nc; CKPT=checkpoint.pt; OUT=prediction.nc
while [[ $# -gt 0 ]]; do case "$1" in
  --tile) TILE="$2"; shift 2;; --init) INIT="$2"; shift 2;; --checkpoint) CKPT="$2"; shift 2;; --out) OUT="$2"; shift 2;; *) shift;; esac; done
tar xzf credit_env.tar.gz -C env 2>/dev/null || true
source env/bin/activate
echo 0.05 > fraction_done.txt
python - "$TILE" "$INIT" "$CKPT" "$OUT" <<'PY'
import json, sys
tile, init, ckpt, out = sys.argv[1:5]
spec = json.load(open(tile))
# The rollout for one tile: same code path as miles-credit/applications/rollout_realtime.py,
# restricted to the tile's lat/lon box and lead window from spec["bounds"] / spec["lead_hours"].
from credit_tile import rollout_tile  # shipped with the app version
rollout_tile(init_path=init, checkpoint=ckpt, bounds=spec["bounds"], lead_hours=spec["lead_hours"], out_path=out,
             progress=lambda f: open("fraction_done.txt", "w").write(f"{f:.3f}"))
PY
echo 1.0 > fraction_done.txt
