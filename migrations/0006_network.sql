-- Joining the NCAR research network is a per-station choice. Joining also makes the station
-- public, because the network map and the research hub only read shared stations.
alter table stations add column if not exists ncar_network boolean not null default false;
alter table stations add column if not exists ncar_joined_at timestamptz;
create index if not exists stations_ncar_idx on stations (ncar_network) where ncar_network;

-- The id a Raspberry Pi gateway reports for a station (the legacy `sensors/<station_id>` topic).
-- The MQTT bridge uses it to find the station, since those messages carry no API key.
alter table stations add column if not exists gateway_id text;
create unique index if not exists stations_gateway_uq on stations (gateway_id) where gateway_id is not null;
