# Changelog

## 3.0.0

### Navigation
- Wizard · Plan · Analysis · Forecast · Community · Library · Flash. The row scrolls on phones.
- Home page: a five-stop pathway (Plan → Build → Deploy → Analyze → Decide).

### Wizard
- New concern: wildfire season (smoke, dry fuels, red-flag wind, evacuation route).
- New step, Resources: printer, spare parts, build-day hands, idle computer, server host, budget.
- New step, Data: readings live on our own server / shared with the community / published as open data, plus the GDEX opt-in.
- Review step: site location (type a place, a ZIP, or coordinates; or use the browser's location).
- Drafts saved by v1/v2 open in v3 unchanged.

### Plan
- Place profile dashboard: SVI overall and four themes, highest-ranked factors with population shares, EJScreen environmental burden, demographic index.
- Decision cards for each named concern.
- Checklist gains a "Data and decisions" group: server, broker, portal, place profile, first forecast, thresholds, sharing level, GDEX.
- Build group: collective tasks (post your printer / ask for printer time).
- Deployment and data portal section; data and archive section with the GDEX switch, consent record, and package preview.
- Copied plan text includes location, sharing level, and GDEX state.

### Analysis (new)
- Full place profile with factor and indicator detail, sources, and report links.
- Decision cards with evidence, exposure, action, and thresholds.
- Last three days of readings per variable.
- Portal: deployment steps, Metabase links and embedded public dashboard, MQTT live feed, decision-toolkit questions, service addresses.

### Forecast (new)
- Where the forecast runs: own machine, community BOINC pool, NCAR CIRRUS; status from the server.
- Request a 2/3/7-day CREDIT run for the site; run table with IPFS content ids.
- History → now → forecast charts per variable with threshold lines for named concerns.
- Decision cards; compute pool, IPFS, and scaling notes.

### Community (new)
- Build collective: print queue per station seeded from the plan (status, who prints it, hours and filament totals), copy and save to server.
- Join the collective: offers board (printer time, parts, build day, compute, host) with server sync and local fallback.
- Compute pool status; what this community shares.

### Library
- Version 3 stack section with the NCAR and community tools used.

### Infrastructure (new, `infra/`)
- docker-compose: Mosquitto (MQTT + WebSockets), TimescaleDB, FastAPI community server, MQTT listener, Metabase + orchestrator, place loader, demo station; profiles for CREDIT runner, BOINC client, IPFS, GDEX publisher.
- Schema with hypertable readings, hourly aggregates, SVI/EJ tables, forecast runs and values, collective, consent, publications; views `station_context`, `latest_readings`, `forecast_verification`.
- BOINC project skeleton (wrapper job, work generator, assimilator).
- Helm chart for CIRRUS mirroring mesonet-siparcs25's layout.
