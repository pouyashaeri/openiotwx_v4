# Community compute pool (BOINC)

Two roles. A **volunteer** lends an idle computer. A **steward** runs the small project server
that hands out forecast work units and stitches the results back together.

## Volunteer: lend a computer

1. Install the BOINC client (boinc.berkeley.edu, or `docker compose --profile volunteer up -d`
   from `infra/`).
2. Attach to the community project with the address and account key the steward shares on the
   Community page:

       boinccmd --project_attach https://compute.your-community.org/openiotwx <account key>

3. Leave it on. BOINC only uses the machine when it is idle, and the client's preferences
   limit CPU, memory, and hours.

## Steward: run the project server

The server is the standard BOINC server image with one application, `credit_tile`.

    docker run -d --name boinc-server -p 80:80 boinc/server_release:latest
    docker exec -it boinc-server bash
      make_project --url_base https://compute.your-community.org openiotwx
      cd ~/projects/openiotwx
      # copy this folder's project/ files into apps/credit_tile/ and run:
      bin/update_versions && bin/xadd && bin/start

Then set in `infra/.env`:

    BOINC_PROJECT_URL=https://compute.your-community.org/openiotwx
    BOINC_ACCOUNT_KEY=<a weak account key from the project admin page>

and restart `database_api`. The Forecast page's "Community compute pool" option turns on.

## How a forecast becomes work units

`forecast_runs` rows with `backend = boinc` are read by `project/work_generator.py` (run as a
BOINC daemon). Each run becomes tiles: one tile per 10° × 10° box around the station and
per 24-hour lead window. A volunteer machine runs `project/run_tile.sh` inside the BOINC
wrapper (`job.xml`): download the GFS initial state for the tile, roll CREDIT forward with
the CPU checkpoint, and upload the prediction file. BOINC validates every tile twice
(`validator`), and `project/assimilator.py` concatenates the tiles, extracts the nearest grid
point per station (the same `extract_station.py` the local runner uses), posts the values to
the community API, pins the bundle on IPFS, and marks the run done.

Work units are deliberately small (about 30 minutes on a laptop) so a phone-charger-class
budget can still contribute, and nothing a volunteer sees contains a person's data: only the
tile box, the initial state, and the model weights.

## Petals, OpenStack, and when to use them

* **Petals** (petals.dev) shards one large model across many volunteer GPUs. CREDIT's
  checkpoints fit on one machine, so BOINC's "whole model, small tiles" split is the better
  fit today. The `backend` column in `forecast_runs` is where a `petals` option would plug in.
* **OpenStack** is a private cloud you run yourself. The helm chart in `infra/helm` deploys to
  any Kubernetes, including one on OpenStack, exactly as it does on NCAR CIRRUS.
