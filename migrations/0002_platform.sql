-- OpenIoTwx platform schema: accounts, saved plans, stations, time-series.
--
-- Portable on purpose: plain Postgres (and the embedded PGLite used by
-- `npm run dev`) gets ordinary tables; when the TimescaleDB extension is
-- available (the Docker stack) the same tables become hypertables with
-- compression, continuous aggregates and retention. Queries are identical.

create table if not exists profiles (
  user_id    text primary key,
  email      text not null,
  name       text not null default '',
  role       text not null default 'user' check (role in ('user', 'admin')),
  suspended  boolean not null default false,
  created_at timestamptz not null default now()
);

-- A saved wizard draft. `data` is the wizard's Persisted blob, restored as-is.
create table if not exists plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  name       text not null,
  config_id  text,
  station_count int not null default 1,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plans_user_idx on plans (user_id, updated_at desc);

create table if not exists stations (
  id            uuid primary key default gen_random_uuid(),
  owner_id      text not null,
  plan_id       uuid references plans (id) on delete set null,
  slug          text not null unique,
  name          text not null,
  description   text not null default '',
  latitude      double precision,
  longitude     double precision,
  elevation_m   double precision,
  config_id     text,
  link          text,
  expected_metrics text[] not null default '{}',
  status        text not null default 'active' check (status in ('active', 'disabled')),
  is_public     boolean not null default false,
  api_key_hash  text not null unique,
  api_key_hint  text not null,
  rate_limit_per_min int not null default 120 check (rate_limit_per_min between 1 and 100000),
  last_seen_at  timestamptz,
  last_values   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists stations_owner_idx on stations (owner_id);
create index if not exists stations_public_idx on stations (is_public) where is_public;

create table if not exists audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  actor_id  text,
  action    text not null,
  target    text,
  detail    jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);

-- Narrow time-series: one row per (station, metric, instant). The unique index
-- makes retried uploads (HTTP retries, MQTT QoS 1 redelivery) idempotent.
create table if not exists measurements (
  time       timestamptz not null,
  station_id uuid not null,
  metric     text not null,
  value      double precision not null
);
create unique index if not exists measurements_uq on measurements (station_id, metric, time);
create index if not exists measurements_time_idx on measurements (time desc);

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'timescaledb') then
    create extension if not exists timescaledb;
    perform create_hypertable('measurements', 'time',
      partitioning_column => 'station_id', number_partitions => 4,
      chunk_time_interval => interval '1 day', if_not_exists => true);
    execute 'alter table measurements set (timescaledb.compress, ' ||
            'timescaledb.compress_segmentby = ''station_id, metric'', ' ||
            'timescaledb.compress_orderby = ''time desc'')';
    perform add_compression_policy('measurements', interval '7 days', if_not_exists => true);

    -- Hourly rollup; dashboards over long ranges read this, not raw rows.
    execute $v$
      create materialized view if not exists measurements_hourly
      with (timescaledb.continuous) as
      select time_bucket('1 hour', time) as bucket, station_id, metric,
             avg(value) as avg, min(value) as min, max(value) as max, count(*) as n
      from measurements
      group by 1, 2, 3
      with no data
    $v$;
    perform add_continuous_aggregate_policy('measurements_hourly',
      start_offset => interval '3 days', end_offset => interval '1 hour',
      schedule_interval => interval '15 minutes', if_not_exists => true);
  else
    -- Same shape as the continuous aggregate, computed on read.
    execute $v$
      create or replace view measurements_hourly as
      select date_trunc('hour', time) as bucket, station_id, metric,
             avg(value) as avg, min(value) as min, max(value) as max, count(*) as n
      from measurements
      group by 1, 2, 3
    $v$;
  end if;
end
$$;
