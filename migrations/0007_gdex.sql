-- GDEX-ready data releases.
--
-- A station's readings only leave the platform for GDEX when its owner says so: the station must be in the
-- NCAR research network, have a location, and carry a recorded consent from a named steward. Consent is
-- kept as a history (grant and revoke), so it is always clear who agreed to what and when.
alter table stations add column if not exists gdex_consent boolean not null default false;
alter table stations add column if not exists gdex_steward text not null default '';
alter table stations add column if not exists gdex_license text not null default 'CC BY 4.0';
alter table stations add column if not exists gdex_consent_at timestamptz;
create index if not exists stations_gdex_idx on stations (gdex_consent) where gdex_consent;

create table if not exists gdex_consent_log (
  id         bigserial primary key,
  station_id uuid not null,
  action     text not null check (action in ('grant', 'revoke')),
  steward    text not null default '',
  license    text not null default '',
  actor_id   text,
  at         timestamptz not null default now()
);
create index if not exists gdex_consent_log_station_idx on gdex_consent_log (station_id, at desc);

-- Dataset description and release cadence (one JSON document per key).
create table if not exists gdex_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- One release per calendar month or quarter. Once it leaves "draft" its files are frozen: the checksum
-- GDEX records for a release is the checksum of the file they will keep downloading.
create table if not exists gdex_releases (
  id                uuid primary key default gen_random_uuid(),
  period            text not null unique,
  kind              text not null check (kind in ('month', 'quarter')),
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  status            text not null default 'draft' check (status in ('draft', 'ready', 'submitted', 'published')),
  station_count     int not null default 0,
  observation_count bigint not null default 0,
  variables         jsonb not null default '[]'::jsonb,
  stations          jsonb not null default '[]'::jsonb,
  issues            jsonb not null default '[]'::jsonb,
  error_count       int not null default 0,
  warning_count     int not null default 0,
  first_time        timestamptz,
  last_time         timestamptz,
  built_by          text,
  built_at          timestamptz not null default now(),
  submission_ref    text not null default '',
  doi               text not null default '',
  notes             text not null default '',
  status_changed_at timestamptz not null default now()
);

create table if not exists gdex_release_files (
  release_id   uuid not null references gdex_releases (id) on delete cascade,
  name         text not null,
  content_type text not null,
  size_bytes   bigint not null,
  sha256       text not null,
  data         bytea not null,
  primary key (release_id, name)
);
