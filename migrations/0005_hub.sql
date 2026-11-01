-- The community hub: what v3's Plan, Analysis, Forecast and Community pages store.
-- v3 ran this as a separate FastAPI server with its own database; here it lives in the
-- same database as accounts and stations, and is served by the app itself at /hub.

-- A request to run CREDIT for a place, and where it stands.
create table if not exists forecast_runs (
  id           bigserial primary key,
  station_id   uuid references stations (id) on delete set null,
  requested_by text,
  latitude     double precision not null,
  longitude    double precision not null,
  init_time    timestamptz not null default now(),
  lead_hours   int not null default 48 check (lead_hours between 6 and 240),
  backend      text not null default 'local' check (backend in ('local', 'boinc', 'cirrus')),
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  detail       text,
  cid          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists forecast_runs_status_idx on forecast_runs (status, created_at);
create index if not exists forecast_runs_user_idx on forecast_runs (requested_by, created_at desc);

-- Forecast values for a station, one row per variable and valid time of each run.
create table if not exists credit_forecasts (
  run_id     bigint references forecast_runs (id) on delete set null,
  station_id uuid not null references stations (id) on delete cascade,
  variable   text not null,
  init_time  timestamptz not null,
  valid_time timestamptz not null,
  value      double precision not null,
  source     text not null default 'credit',
  primary key (station_id, variable, init_time, valid_time, source)
);
create index if not exists credit_forecasts_latest_idx on credit_forecasts (station_id, init_time desc);

-- The build collective: people offering printers, parts, hands, compute, a host.
create table if not exists collective_members (
  id         bigserial primary key,
  owner_id   text,
  name       text not null,
  contact    text not null default '',
  area       text not null default '',
  offers     text[] not null default '{}',
  printers   text not null default '',
  notes      text not null default '',
  created_at timestamptz not null default now()
);

-- The print queue. Each person keeps their own rows; everyone can see them.
create table if not exists collective_inventory (
  id            bigserial primary key,
  owner_id      text not null,
  station_label text not null,
  part_id       text not null,
  status        text not null default 'queued' check (status in ('queued', 'printing', 'done', 'failed')),
  owner         text not null default '',
  updated_at    timestamptz not null default now(),
  unique (owner_id, station_label, part_id)
);

-- Who decided what about sharing a station's data (the record behind the GDEX switch).
create table if not exists data_consent (
  id          bigserial primary key,
  owner_id    text not null,
  station_id  text not null,
  steward     text not null,
  contact     text not null default '',
  scope       text not null default 'local' check (scope in ('local', 'community', 'open')),
  gdex        boolean not null default false,
  license     text not null default 'CC BY 4.0',
  recorded_at timestamptz not null default now()
);
create index if not exists data_consent_owner_idx on data_consent (owner_id, station_id, recorded_at desc);

-- What the publisher service has packaged and sent (or would send, in a dry run).
create table if not exists gdex_publications (
  id         bigserial primary key,
  station_id text not null,
  period     text not null default '',
  status     text not null default 'dry-run',
  cid        text,
  detail     text,
  created_at timestamptz not null default now()
);

-- The place profile (SVI tract and EJScreen buffer) kept beside a station, for services that join it.
create table if not exists place_profiles (
  station_id uuid primary key references stations (id) on delete cascade,
  svi        jsonb,
  ej         jsonb,
  fetched_at timestamptz not null default now()
);
