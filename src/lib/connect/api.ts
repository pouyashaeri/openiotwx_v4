import { cleanUrl } from "./settings.ts";

/**
 * Client for the community server in `infra/services/database_api`. Every call returns a
 * result object instead of throwing, because the site has to keep working when the server is
 * off, unreachable, or simply not set up yet. The route shapes mirror NCAR's mesonet-siparcs25
 * `database_api`, extended with the v3 tables (forecast runs, collective, consent).
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type Station = {
  station_id: string;
  device: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  organization: string | null;
  last_active: string | null;
};

export type Reading = {
  station_id: string;
  measurement: string;
  reading_value: number;
  sensor_model: string | null;
  timestamp: string;
};

export type ForecastPoint = {
  station_id: string;
  variable: string;
  valid_time: string;
  value: number;
  init_time: string;
  source: "credit" | "gfs" | "demo";
};

export type ForecastRun = {
  id: number;
  station_id: string | null;
  latitude: number;
  longitude: number;
  init_time: string;
  lead_hours: number;
  backend: "local" | "boinc" | "cirrus";
  status: "queued" | "running" | "done" | "failed";
  created_at: string;
  cid: string | null;
};

export type ComputeStatus = {
  backend: "local" | "boinc" | "cirrus";
  available: boolean;
  detail: string;
  volunteers?: number;
  queued?: number;
};

export type CollectiveMember = {
  id: number;
  name: string;
  contact: string;
  area: string;
  offers: string[];
  printers: string;
  notes: string;
  created_at: string;
};

export type InventoryItem = {
  id: number;
  station_label: string;
  part_id: string;
  status: "queued" | "printing" | "done" | "failed";
  owner: string;
  updated_at: string;
};

export type ConsentRecord = {
  station_id: string;
  steward: string;
  contact: string;
  scope: "local" | "community" | "open";
  gdex: boolean;
  license: string;
  recorded_at: string;
};

export type HealthInfo = { status: string; version?: string; services?: Record<string, boolean> };

const TIMEOUT_MS = 8000;

async function call<T>(
  base: string,
  path: string,
  init?: RequestInit,
  timeout = TIMEOUT_MS,
): Promise<ApiResult<T>> {
  const root = cleanUrl(base);
  if (!root) return { ok: false, error: "No server address set." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${root}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `${response.status} from ${path}` };
    }
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === "AbortError"
        ? "The server did not answer in time."
        : "Could not reach the server.";
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: (base: string) => call<HealthInfo>(base, "/health", undefined, 4000),
  stations: (base: string) => call<Station[]>(base, "/api/stations/", undefined, 4000),
  readings: (base: string, stationId: string, hours = 72) =>
    call<Reading[]>(base, `/api/readings/${encodeURIComponent(stationId)}?hours=${hours}`),
  forecast: (base: string, stationId: string) =>
    call<ForecastPoint[]>(base, `/api/credit-forecast/${encodeURIComponent(stationId)}/`),
  forecastRuns: (base: string) => call<ForecastRun[]>(base, "/api/forecast-runs/"),
  requestForecast: (
    base: string,
    body: { latitude: number; longitude: number; lead_hours: number; backend: string; station_id?: string },
  ) => call<ForecastRun>(base, "/api/forecast-runs/", { method: "POST", body: JSON.stringify(body) }),
  compute: (base: string) => call<ComputeStatus[]>(base, "/api/compute/status"),
  ej: (base: string, lat: number, lon: number) =>
    call<Record<string, unknown>>(base, `/api/place/ej?lat=${lat}&lon=${lon}`, undefined, 60000),
  collective: (base: string) => call<CollectiveMember[]>(base, "/api/collective/members/"),
  join: (base: string, body: Omit<CollectiveMember, "id" | "created_at">) =>
    call<CollectiveMember>(base, "/api/collective/members/", { method: "POST", body: JSON.stringify(body) }),
  inventory: (base: string) => call<InventoryItem[]>(base, "/api/collective/inventory/"),
  saveInventory: (base: string, items: Omit<InventoryItem, "id" | "updated_at">[]) =>
    call<InventoryItem[]>(base, "/api/collective/inventory/", { method: "PUT", body: JSON.stringify(items) }),
  consent: (base: string, body: Omit<ConsentRecord, "recorded_at">) =>
    call<ConsentRecord>(base, "/api/consent/", { method: "POST", body: JSON.stringify(body) }),
  consents: (base: string) => call<ConsentRecord[]>(base, "/api/consent/"),
};
