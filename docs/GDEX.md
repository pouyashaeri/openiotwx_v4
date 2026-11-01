# Getting community station data into GDEX

GDEX is the NSF NCAR Geoscience Data Exchange (https://gdex.ucar.edu/): a long-term archive that curates research data and gives it a DOI. This is how a reading from a station built with the wizard ends up there, what the app does for it, and what still has to be confirmed with the GDEX team.

## What GDEX asked for

From the exchange with Riley Conroy (NCAR CISL Data Engineering and Curation Group, 29 October 2026):

- **Minimum standards:** "don't do anything bizarre": no strings for dates, no missing coordinates, no missing descriptive metadata.
- **Preferred:** full CF compliance (https://cfconventions.org/).
- **Process:** create a submission at https://gdex.ucar.edu/resources/submit-data/, provide metadata and the location of the data, then GDEX ingests what exists, archives it and assigns a DOI. A continuously updating dataset needs a little setup on their side.
- **Cadence we proposed:** a submission once a month, or quarterly. Agbeli Ameko's framing: the GDEX-ready data sits in our database and is pulled in; the wizard and build process show how a community gets there.

| GDEX's ask | What a release does |
|---|---|
| No dates as strings | `time` is a number: `seconds since 1970-01-01 00:00:00` UTC, standard calendar, `axis T`. The CSV has a numeric `time_utc_s` column and no date strings. |
| Coordinates | Every station has `lat`, `lon`, `alt` (with CF standard names, units and axes). Coordinates are rounded to 3 decimals (about 110 m) by default so a home station is a neighbourhood, not a rooftop; the admin console can change it (2 to 6). |
| Descriptive metadata | Global attributes (ACDD-1.3): title, summary, institution, creator, license, keywords, history, time and space coverage, and more. Every variable has `long_name` and `units`, and a CF `standard_name` where one fits. A `*_metadata.json` file repeats it and adds the quality report. A release is **blocked** until the dataset description is filled in. |
| CF compliance | `Conventions = "CF-1.8, ACDD-1.3"`, `featureType = "timeSeries"`, contiguous ragged array representation (CF section 9.3.4): one file holds all stations. |
| Format, compression, chunking | NetCDF-3 classic is written by the app itself (it needs no libraries and every tool reads it). `infra/services/gdex_publisher/netcdf4_convert.py` converts a release to NetCDF-4 with zlib compression and chunking along the observation axis. |
| Cadence | One release per finished calendar month or quarter (UTC), set in the console. |

## What has been checked, and what has not

Checked here:

- `scripts/verify-netcdf.py` reads a release with an independent reader (netCDF4, or scipy as a fallback) and checks numeric time, coordinates, `units` and `long_name` on every variable, `_FillValue`, the ragged-array structure, and global metadata. It passes on releases built by the app (`npm run e2e:gdex` does this on every run).
- The same file converted to NetCDF-4 by `netcdf4_convert.py` passes the same checks and every value matches the original.
- Files are byte-for-byte reproducible: the same input gives the same SHA-256, and `SHA256SUMS` verifies with a standard tool.

**Not checked: the official CF checker** (https://github.com/cedadev/cf-checker). It needs the UDUNITS-2 library, which was not available where this was built. Run it before the first real submission:

```bash
conda install -c conda-forge cfchecker      # brings UDUNITS-2
cfchecks -v 1.8 openiotwx-network_2026-10.nc
```

The layout and attributes follow the CF-1.8 rules for a contiguous ragged time series, but the checker is the authority. If it reports anything, the fixes are in `src/lib/gdex/release.ts` (`netcdfFile`).

**We have not seen GDEX's compliance document.** Riley shared it with Agbeli and Pouya directly. Build to it first, and treat everything above as the CF/ACDD baseline.

## Questions to settle with GDEX

1. Does the compliance document ask for anything beyond CF-1.8 and ACDD-1.3 (required global attributes, file naming, size limits)?
2. NetCDF-3 classic or NetCDF-4 with compression? (Both are produced; which do they want to ingest?) Preferred chunking and compression level?
3. One dataset for the whole network (what this builds), or one per station or per community?
4. Time resolution: the file keeps each station's own reporting interval. Do they want a regular grid (for example hourly means) instead?
5. Quality flags. The platform has no per-value QC yet. Do they need `*_qc` variables, and from what rules?
6. Standard names for the variables that have none today (rain depth versus accumulated rain, the raw gateway sensors, mean radiant temperature, globe temperature). They are described by `long_name` and `units` only; see `src/lib/gdex/cf.ts`.
7. Coordinate precision. 3 decimals is the default for privacy. Is that acceptable, or do they need more?
8. Naming authority, dataset `id` and DOI conventions, and who the dataset contact is (`GDEX_CONTACT_EMAIL`).
9. How do they want to pull: poll `/gdex/manifest.json`, or be notified when a release is ready?
10. Late data: a release is frozen when it is marked ready. Do they want corrections as a new version of the period?

## How it works

```
 station (wizard + flasher) ──► ingest ──► measurements table
                                              │
   steward gives consent on the station page  │   (station must be in the NCAR network, have a location, have a named steward)
                                              ▼
   scheduler (daily) ─► DRAFT release for the period that just ended
                                              │
   admin reads the quality report in the console, marks it READY
                                              ▼
   GDEX pulls /gdex/manifest.json  (files + SHA-256)  ──►  GDEX ingests, archives, assigns a DOI
                                              │
   admin records the submission reference (SUBMITTED) and the DOI (PUBLISHED)
```

Nothing goes out on its own. A draft is private (staff only). Only a person promotes it, and only then does it appear in the public manifest.

### Who does what

| Who | What |
|---|---|
| Steward (station owner) | Joins the NCAR network, then gives GDEX consent on the station page with their name and a license. Can withdraw at any time. |
| Admin | Fills in the dataset description once, builds or reviews drafts, marks them ready, records the GDEX submission reference and DOI. |
| Scheduler | `scripts/gdex-release.mjs` builds the draft for the finished period. It never marks anything ready. |
| GDEX | Pulls the files, reviews, archives, assigns the DOI. |

### Who is included

A station is in a release only if **all** of these are true: it is your own device station (imported CHORDS stations are never included, their data belongs to the portal that publishes it), it is in the NCAR research network, it is active and has a location, and its steward gave consent. Consent is logged (grant and revoke) in `gdex_consent_log`.

Withdrawing consent leaves the station out of future releases. Releases already made stay in the archive: a DOI cannot be unpublished. Say so wherever consent is asked (the station page does).

## What a release contains

For period `2026-10` (or `2026-Q4`):

| File | What |
|---|---|
| `openiotwx-network_2026-10.nc` | CF-1.8 + ACDD-1.3 NetCDF, all stations. |
| `openiotwx-network_2026-10.csv` | The same observations as CSV (numeric time, coordinates on every row, `#` comment lines with units). |
| `openiotwx-network_2026-10_metadata.json` | Dataset, station and variable description, the quality report, file checksums, and the fields the GDEX submission form asks for. |
| `SHA256SUMS` | Checksums, for `sha256sum -c SHA256SUMS`. |

NetCDF layout:

- dimensions: `station`, `obs` (all stations' observations back to back), `id_strlen`, `name_strlen`
- `station_id(station, id_strlen)` with `cf_role = timeseries_id`, `station_name`, `lat`, `lon`, `alt`
- `row_size(station)` with `sample_dimension = "obs"`: how many observations belong to each station
- `time(obs)` (double, numeric), then one `float` variable per measurement on `obs`, each with `units`, `long_name`, optional `standard_name`, `coordinates = "time lat lon alt"`, `_FillValue`, `actual_range`

Measurement names and their CF descriptions are in `src/lib/gdex/cf.ts` and are listed on the public page (`/gdex`) and in `/gdex/dataset.json`. A standard name is only added where one really describes the measurement; never guessed.

### The quality report

Every build produces a report stored with the release and shown in the console.

- **Errors block a release:** missing dataset description (title, summary, institution, creator, contact, license), no eligible station, a station without valid coordinates, a missing steward, no readings.
- **Warnings are reported and the data is kept:** no elevation, duplicate timestamps (merged), non-numeric values (left out), values outside a plausible physical range, a measurement with no known units, a station with fewer than 10 readings.
- **Info:** readings outside the period (left out), stations with no readings in the period, variables with no standard name.

The built NetCDF is read back and checked before it is offered; a mismatch becomes an error.

## Running it

First time:

1. Set `GDEX_CONTACT_EMAIL` in `.env` (or fill the contact fields in the console). Set `GDEX_RELEASE_TOKEN` if you want the scheduler.
2. Admin console, **GDEX** tab: review the title, summary, institution, creator and contact, the cadence and the license. Save.
3. Stewards join the network and give consent on their station pages.
4. `docker compose --profile gdex up -d` starts the scheduler. Or build by hand: pick the period and press **Check first** (shows the report without storing anything), then **Build draft**.
5. Read the report, press **Mark ready for GDEX**. The release is now in the manifest.
6. Start the submission at https://gdex.ucar.edu/resources/submit-data/. `/gdex/dataset.json` has the title, abstract, keywords, license, format and contact in the form's terms, and `/gdex/manifest.json` is the data location.
7. When GDEX confirms, press **Record as submitted to GDEX** (with their reference), and when they publish, **Record as published** with the DOI. Both show on the public `/gdex` page.

Each later period: the scheduler builds the draft; steps 5 and 7 repeat. Once a release is ready, it cannot be rebuilt (the checksum GDEX holds stays valid). Send a correction as a note on the release and agree the versioning with GDEX.

### Interfaces

| Endpoint | Who | What |
|---|---|---|
| `GET /gdex/manifest.json` | public | Releases that are ready or later, with file URLs, sizes and SHA-256. |
| `GET /gdex/dataset.json` | public | The dataset in the submission form's terms, plus the variable vocabulary. |
| `GET /gdex/releases/<period>/<file>` | public (drafts: staff only) | A release file, with `ETag` and `X-Content-SHA256`. |
| `POST /api/gdex/release` | scheduler, `x-gdex-token` | Builds the draft for the period that just ended (or `{"period": "2026-10"}`). |

Environment: `GDEX_CONTACT_EMAIL`, `GDEX_RELEASE_TOKEN`, `GDEX_CHECK_HOURS` (scheduler, default 12), `APP_VERSION` (written into files).

### Verify a release

```bash
python scripts/verify-netcdf.py openiotwx-network_2026-10.nc          # independent check
sha256sum -c SHA256SUMS                                                # the files are what the manifest says
python infra/services/gdex_publisher/netcdf4_convert.py openiotwx-network_2026-10.nc   # NetCDF-4 copy, verified value by value
cfchecks -v 1.8 openiotwx-network_2026-10.nc                           # the official CF checker (see above)
```

## Tests

- `src/lib/gdex/release.test.ts` (unit): periods, the CF table, the NetCDF writer round trip, release structure, rounding, determinism, and every blocking rule.
- `npm run e2e:gdex` (browser): consent, preview, build, promote, public pull with checksum, submit and publish, the public page, withdrawal, and an independent read of the file. Run it on a **fresh** server started with `GDEX_ALLOW_OPEN_PERIOD=1 GDEX_RELEASE_TOKEN=gdextest` (the first account becomes the super-admin). `GDEX_ALLOW_OPEN_PERIOD=1` is a testing aid only: ingest accepts just the last 30 days, so a test cannot fill a month that has already ended. Never set it in production.

## Where the code is

| | |
|---|---|
| `src/lib/gdex/netcdf.ts` | NetCDF-3 writer and reader, no dependencies |
| `src/lib/gdex/cf.ts` | measurement name to CF standard name, units, plausible range |
| `src/lib/gdex/release.ts` | builds the files and the quality report (pure) |
| `src/lib/gdex/period.ts` | month and quarter periods |
| `src/lib/gdex/gdex.server.ts` | consent, settings, releases, manifest (database) |
| `src/lib/gdex/api.ts` | server functions for the console, the station page and the public page |
| `src/routes/gdex.*`, `src/routes/api/gdex.release.ts` | the public page and endpoints |
| `src/components/gdex-panel.tsx`, `gdex-admin.tsx`, `gdex-ready.tsx` | station consent, admin tab, the wizard's readiness card |
| `migrations/0007_gdex.sql` | consent columns and log, settings, releases, release files |
| `scripts/gdex-release.mjs` | the scheduler |

The older `infra/services/gdex_publisher` (Python, for the v3 stack's own database) is separate and still works there. This release builder works on the platform's own database and does not need it.
