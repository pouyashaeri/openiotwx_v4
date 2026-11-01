-- Saved questions the orchestrator creates in Metabase. One block per question:
--   -- name: <title>   -- display: <scalar|line|bar|table|row>   -- collection: <Station overview|Decision toolkit>
-- {{station_id}} is a Metabase field filter variable; the orchestrator sets its default to each station.

-- name: Latest readings
-- display: table
-- collection: Station overview
SELECT measurement, round(reading_value::numeric, 2) AS value, time
FROM latest_readings
WHERE station_id = {{station_id}}
ORDER BY measurement;

-- name: Temperature, last 7 days
-- display: line
-- collection: Station overview
SELECT hour, round(mean_value::numeric, 1) AS temperature_c
FROM readings_hourly
WHERE station_id = {{station_id}} AND measurement = 'temperature' AND hour > now() - interval '7 days'
ORDER BY hour;

-- name: Rain, last 30 days (mm per day)
-- display: bar
-- collection: Station overview
SELECT date_trunc('day', time) AS day, round(sum(reading_value)::numeric, 1) AS rain_mm
FROM readings
WHERE station_id = {{station_id}} AND measurement = 'rain' AND time > now() - interval '30 days'
GROUP BY 1 ORDER BY 1;

-- name: Fine particles, last 7 days
-- display: line
-- collection: Station overview
SELECT hour, round(mean_value::numeric, 1) AS pm25
FROM readings_hourly
WHERE station_id = {{station_id}} AND measurement = 'pm25' AND hour > now() - interval '7 days'
ORDER BY hour;

-- name: Forecast vs recorded temperature
-- display: line
-- collection: Station overview
SELECT f.valid_time, round((f.value - 273.15)::numeric, 1) AS forecast_c, round(h.mean_value::numeric, 1) AS recorded_c
FROM credit_forecasts f
LEFT JOIN readings_hourly h ON h.station_id = f.station_id AND h.measurement = 'temperature' AND h.hour = date_trunc('hour', f.valid_time)
WHERE f.station_id = {{station_id}} AND f.variable = 't2m'
  AND f.init_time = (SELECT max(init_time) FROM credit_forecasts WHERE station_id = {{station_id}})
ORDER BY f.valid_time;

-- name: Place profile
-- display: table
-- collection: Decision toolkit
SELECT station_id, tract_name, county, state,
       round((svi_overall*100)::numeric) AS svi_overall_pctile, svi_flags,
       pct_over_65, pct_disability, pct_no_vehicle, pct_mobile_homes,
       ej_pm25, ej_pm25_pctile, ej_ozone_pctile, ej_demog_index_pctile, round((ej_lowinc_pct*100)::numeric,1) AS ej_lowinc_pct
FROM station_context
WHERE station_id = {{station_id}};

-- name: Hours above 35 C last 30 days, with who lives here
-- display: table
-- collection: Decision toolkit
SELECT c.station_id, count(*) FILTER (WHERE h.max_value >= 35) AS hours_over_35c,
       c.pct_over_65, c.pct_disability, round((c.svi_overall*100)::numeric) AS svi_overall_pctile
FROM station_context c
LEFT JOIN readings_hourly h ON h.station_id = c.station_id AND h.measurement = 'temperature' AND h.hour > now() - interval '30 days'
WHERE c.station_id = {{station_id}}
GROUP BY c.station_id, c.pct_over_65, c.pct_disability, c.svi_overall;

-- name: Recorded PM2.5 vs the EJScreen estimate
-- display: table
-- collection: Decision toolkit
SELECT c.station_id, round(avg(h.mean_value)::numeric, 1) AS recorded_pm25_30d, c.ej_pm25 AS ejscreen_pm25, c.ej_pm25_pctile
FROM station_context c
LEFT JOIN readings_hourly h ON h.station_id = c.station_id AND h.measurement = 'pm25' AND h.hour > now() - interval '30 days'
WHERE c.station_id = {{station_id}}
GROUP BY c.station_id, c.ej_pm25, c.ej_pm25_pctile;

-- name: Forecast error, last ten runs
-- display: table
-- collection: Decision toolkit
SELECT init_time, variable, round(avg(abs(error))::numeric, 2) AS mean_abs_error, count(*) AS hours
FROM forecast_verification
WHERE station_id = {{station_id}}
GROUP BY init_time, variable ORDER BY init_time DESC LIMIT 10;

-- name: Rain in the last 24 hours vs the flood watch line
-- display: scalar
-- collection: Decision toolkit
SELECT round(sum(reading_value)::numeric, 1) AS rain_24h_mm
FROM readings
WHERE station_id = {{station_id}} AND measurement = 'rain' AND time > now() - interval '24 hours';
