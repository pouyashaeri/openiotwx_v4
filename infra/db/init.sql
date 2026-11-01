-- OpenIoTwx v3 schema. Runs once when the postgres volume is created.
-- Readings are a Timescale hypertable; everything else is small reference and bookkeeping.

CREATE DATABASE metabase;

\connect iotwx;

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS stations (
    station_id    VARCHAR(80) PRIMARY KEY,
    device        VARCHAR(50),
    longitude     DOUBLE PRECISION,
    latitude      DOUBLE PRECISION,
    altitude      DOUBLE PRECISION,
    organization  VARCHAR(120),
    steward       VARCHAR(120),
    contact       VARCHAR(160),
    topic         VARCHAR(200),
    tract_fips    VARCHAR(11),
    created_at    TIMESTAMPTZ DEFAULT now(),
    last_active   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS readings (
    time            TIMESTAMPTZ NOT NULL DEFAULT now(),
    station_id      VARCHAR(80) NOT NULL REFERENCES stations(station_id),
    measurement     VARCHAR(50) NOT NULL,
    reading_value   DOUBLE PRECISION NOT NULL,
    sensor_model    VARCHAR(50),
    sensor_protocol VARCHAR(20),
    edge_id         VARCHAR(50),
    rssi            INTEGER
);
SELECT create_hypertable('readings', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS readings_station_time ON readings (station_id, time DESC);
CREATE INDEX IF NOT EXISTS readings_measurement ON readings (measurement, time DESC);

-- Hourly means keep Metabase questions fast on a Raspberry Pi.
CREATE MATERIALIZED VIEW IF NOT EXISTS readings_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS hour,
       station_id,
       measurement,
       avg(reading_value) AS mean_value,
       min(reading_value) AS min_value,
       max(reading_value) AS max_value,
       count(*)           AS samples
FROM readings
GROUP BY hour, station_id, measurement
WITH NO DATA;
SELECT add_continuous_aggregate_policy('readings_hourly',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes', if_not_exists => TRUE);

-- CDC/ATSDR Social Vulnerability Index 2022, one row per tract a station sits in.
CREATE TABLE IF NOT EXISTS svi_tracts (
    fips          VARCHAR(11) PRIMARY KEY,
    location      TEXT,
    county        TEXT,
    state         VARCHAR(2),
    population    INTEGER,
    rpl_themes    DOUBLE PRECISION,
    rpl_theme1    DOUBLE PRECISION,
    rpl_theme2    DOUBLE PRECISION,
    rpl_theme3    DOUBLE PRECISION,
    rpl_theme4    DOUBLE PRECISION,
    f_total       INTEGER,
    attributes    JSONB,          -- every EP_/EPL_/F_ field as returned by the service
    fetched_at    TIMESTAMPTZ DEFAULT now()
);

-- EJScreen indicators (via the EJAM API) for the 1-mile buffer around each station.
CREATE TABLE IF NOT EXISTS ej_indicators (
    station_id    VARCHAR(80) PRIMARY KEY REFERENCES stations(station_id),
    buffer_miles  DOUBLE PRECISION DEFAULT 1,
    population    INTEGER,
    demog_index_pctile       DOUBLE PRECISION,
    supp_demog_index_pctile  DOUBLE PRECISION,
    pm25          DOUBLE PRECISION,
    pm25_pctile   DOUBLE PRECISION,
    ozone         DOUBLE PRECISION,
    ozone_pctile  DOUBLE PRECISION,
    no2_pctile    DOUBLE PRECISION,
    dpm_pctile    DOUBLE PRECISION,
    traffic_pctile DOUBLE PRECISION,
    lowinc_pct    DOUBLE PRECISION,
    minority_pct  DOUBLE PRECISION,
    over64_pct    DOUBLE PRECISION,
    under5_pct    DOUBLE PRECISION,
    row_json      JSONB,          -- the full EJAM row
    report_url    TEXT,
    fetched_at    TIMESTAMPTZ DEFAULT now()
);

-- CREDIT (or GFS) forecast values at the grid point nearest each station.
CREATE TABLE IF NOT EXISTS forecast_runs (
    id            SERIAL PRIMARY KEY,
    station_id    VARCHAR(80) REFERENCES stations(station_id),
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    init_time     TIMESTAMPTZ,
    lead_hours    INTEGER NOT NULL DEFAULT 48,
    backend       VARCHAR(10) NOT NULL DEFAULT 'local',   -- local | boinc | cirrus
    status        VARCHAR(10) NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
    cid           VARCHAR(80),                            -- IPFS content id of the output bundle
    detail        TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_forecasts (
    run_id        INTEGER REFERENCES forecast_runs(id) ON DELETE CASCADE,
    station_id    VARCHAR(80) REFERENCES stations(station_id),
    variable      VARCHAR(20) NOT NULL,   -- t2m, SP, wind10, rh, tp, pm25 ...
    init_time     TIMESTAMPTZ NOT NULL,
    valid_time    TIMESTAMPTZ NOT NULL,
    value         DOUBLE PRECISION NOT NULL,
    source        VARCHAR(10) NOT NULL DEFAULT 'credit',  -- credit | gfs | demo
    PRIMARY KEY (station_id, variable, init_time, valid_time, source)
);
CREATE INDEX IF NOT EXISTS credit_station_valid ON credit_forecasts (station_id, valid_time);

-- Build collective
CREATE TABLE IF NOT EXISTS collective_members (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    contact     VARCHAR(160),
    area        VARCHAR(160),
    offers      TEXT[] NOT NULL DEFAULT '{}',   -- printer, parts, hands, compute, host
    printers    TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collective_inventory (
    id            SERIAL PRIMARY KEY,
    station_label VARCHAR(120) NOT NULL,
    part_id       VARCHAR(40) NOT NULL,
    status        VARCHAR(10) NOT NULL DEFAULT 'queued',
    owner         VARCHAR(120),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (station_label, part_id)
);

-- Who decided what about the data, and when. The publisher refuses to send without a row.
CREATE TABLE IF NOT EXISTS data_consent (
    id          SERIAL PRIMARY KEY,
    station_id  VARCHAR(80) NOT NULL,
    steward     VARCHAR(120) NOT NULL,
    contact     VARCHAR(160),
    scope       VARCHAR(10) NOT NULL,        -- local | community | open
    gdex        BOOLEAN NOT NULL DEFAULT FALSE,
    license     VARCHAR(40) NOT NULL DEFAULT 'CC BY 4.0',
    recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gdex_publications (
    id            SERIAL PRIMARY KEY,
    station_id    VARCHAR(80) NOT NULL,
    period_start  DATE NOT NULL,
    period_end    DATE NOT NULL,
    package_path  TEXT,
    cid           VARCHAR(80),
    status        VARCHAR(12) NOT NULL DEFAULT 'packaged',   -- packaged | uploaded | failed | dry-run
    detail        TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (station_id, period_start, period_end)
);

-- The decision toolkit's main join: every station beside its tract and its EJ buffer.
CREATE OR REPLACE VIEW station_context AS
SELECT s.station_id, s.latitude, s.longitude, s.organization, s.last_active,
       t.fips AS tract_fips, t.location AS tract_name, t.county, t.state,
       t.rpl_themes AS svi_overall, t.rpl_theme1 AS svi_socioeconomic, t.rpl_theme2 AS svi_household,
       t.rpl_theme3 AS svi_minority, t.rpl_theme4 AS svi_housing_transport, t.f_total AS svi_flags,
       (t.attributes->>'EP_AGE65')::double precision  AS pct_over_65,
       (t.attributes->>'EP_DISABL')::double precision AS pct_disability,
       (t.attributes->>'EP_NOVEH')::double precision  AS pct_no_vehicle,
       (t.attributes->>'EP_MOBILE')::double precision AS pct_mobile_homes,
       e.pm25 AS ej_pm25, e.pm25_pctile AS ej_pm25_pctile, e.ozone_pctile AS ej_ozone_pctile,
       e.demog_index_pctile AS ej_demog_index_pctile, e.lowinc_pct AS ej_lowinc_pct
FROM stations s
LEFT JOIN svi_tracts t ON t.fips = s.tract_fips
LEFT JOIN ej_indicators e ON e.station_id = s.station_id;

-- Latest value per measurement per station, for the "now" column of the decision cards.
CREATE OR REPLACE VIEW latest_readings AS
SELECT DISTINCT ON (station_id, measurement) station_id, measurement, reading_value, time
FROM readings
ORDER BY station_id, measurement, time DESC;

-- Forecast vs. what actually happened, for judging how far to trust the model here.
CREATE OR REPLACE VIEW forecast_verification AS
SELECT f.station_id, f.variable, f.init_time, f.valid_time, f.value AS forecast_value,
       h.mean_value AS observed_mean, (f.value - h.mean_value) AS error
FROM credit_forecasts f
JOIN readings_hourly h
  ON h.station_id = f.station_id
 AND h.hour = date_trunc('hour', f.valid_time)
 AND h.measurement = CASE f.variable WHEN 't2m' THEN 'temperature' WHEN 'SP' THEN 'pressure'
                                      WHEN 'wind10' THEN 'wind_speed' WHEN 'rh' THEN 'humidity'
                                      WHEN 'tp' THEN 'rain' WHEN 'pm25' THEN 'pm25' ELSE f.variable END;
