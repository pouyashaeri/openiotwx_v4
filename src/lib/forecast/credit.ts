import type { ForecastPoint, Reading } from "@/lib/connect/api";
import type { Series } from "@/lib/place/decide";

/**
 * CREDIT is NSF NCAR's AI Earth-system model (github.com/NCAR/miles-credit). In this project it
 * runs the way mesonet-siparcs25 ran it: a 6-hourly rollout initialized from GFS, with the
 * nearest grid point written to the database for every station. Three places can do that work.
 */
export type BackendId = "local" | "boinc" | "cirrus";

export type Backend = {
  id: BackendId;
  name: string;
  who: string;
  how: string;
  cost: string;
  needs: string;
};

export const BACKENDS: Backend[] = [
  {
    id: "local",
    name: "Our own machine",
    who: "One computer the community controls",
    how: "The `credit` service in docker compose runs the rollout on a schedule. A GPU finishes a 7-day forecast in minutes; a CPU takes hours and still works.",
    cost: "Electricity and one person who knows where the box is.",
    needs: "About 16 GB RAM, 40 GB disk for the checkpoint and static files, and the GFS download.",
  },
  {
    id: "boinc",
    name: "Community compute pool",
    who: "Idle computers that neighbors volunteered",
    how: "BOINC splits each forecast into work units (one tile and lead window each). Volunteers' machines pick them up, results are validated twice, and the server stitches the tiles back together.",
    cost: "Nothing per run. The steward hosts the small BOINC project server, or joins one another community runs.",
    needs: "The BOINC client on each volunteer machine and the project key from the Community page.",
  },
  {
    id: "cirrus",
    name: "NCAR CIRRUS cloud",
    who: "NSF NCAR's Kubernetes platform",
    how: "The same containers deploy with the helm chart in `infra/helm`, the way mesonet-siparcs25 did. Storage, GPU, and ingress are requested per project.",
    cost: "Requires an NCAR/UCAR project allocation and a sponsor.",
    needs: "A CIRRUS namespace, a container registry login, and the chart values filled in.",
  },
];

/** Variables the forecast page draws, with the unit the station reports in. */
export const VARIABLES: Array<{ id: string; label: string; unit: string; fromCredit: boolean; measure?: string }> = [
  { id: "t", label: "Air temperature", unit: "°C", fromCredit: true, measure: "temperature" },
  { id: "rh", label: "Relative humidity", unit: "%", fromCredit: false, measure: "humidity" },
  { id: "p", label: "Surface pressure", unit: "hPa", fromCredit: true, measure: "pressure" },
  { id: "wind", label: "Wind speed", unit: "m/s", fromCredit: true, measure: "wind_speed" },
  { id: "rain", label: "Rain", unit: "mm/h", fromCredit: false, measure: "rain" },
  { id: "pm25", label: "Fine particles", unit: "µg/m³", fromCredit: false, measure: "pm25" },
];

/** Station measurement names (as published over MQTT) → the page's variable ids. */
const MEASURE_TO_VAR: Record<string, string> = {
  temperature: "t",
  temp: "t",
  t2m: "t",
  humidity: "rh",
  rh: "rh",
  pressure: "p",
  sp: "p",
  wind_speed: "wind",
  wind: "wind",
  wind_gust: "gust",
  rain: "rain",
  precipitation: "rain",
  pm25: "pm25",
  "pm2.5": "pm25",
  soil_moisture: "soil",
  co2: "co2",
  ozone: "o3",
};

/** CREDIT output names (from the siparcs25 write_to_db mapping) → the page's variable ids. */
const CREDIT_TO_VAR: Record<string, string> = {
  t2m: "t",
  T2M: "t",
  SP: "p",
  sp: "p",
  wind10: "wind",
  ws: "wind",
  rh: "rh",
  RH: "rh",
  tp: "rain",
  rain: "rain",
  pm25: "pm25",
};

export function readingsToSeries(readings: Reading[]): Series {
  const out: Series = {};
  for (const r of readings) {
    const key = MEASURE_TO_VAR[r.measurement.toLowerCase()];
    if (!key) continue;
    let value = r.reading_value;
    if (key === "p" && value > 2000) value = value / 100; // Pa → hPa
    (out[key] ??= []).push({ t: r.timestamp, v: value });
  }
  for (const key of Object.keys(out)) out[key]!.sort((a, b) => a.t.localeCompare(b.t));
  return out;
}

export function forecastToSeries(points: ForecastPoint[]): Series {
  const out: Series = {};
  for (const p of points) {
    const key = CREDIT_TO_VAR[p.variable] ?? p.variable;
    let value = p.value;
    if (key === "t" && value > 150) value = value - 273.15; // K → °C
    if (key === "p" && value > 2000) value = value / 100;
    (out[key] ??= []).push({ t: p.valid_time, v: value });
  }
  for (const key of Object.keys(out)) out[key]!.sort((a, b) => a.t.localeCompare(b.t));
  return out;
}

export function latest(series: Series): Record<string, number> {
  const now: Record<string, number> = {};
  for (const [key, points] of Object.entries(series)) {
    const last = points[points.length - 1];
    if (last) now[key] = last.v;
  }
  if (series.rain?.length) {
    now.rain_1h = series.rain[series.rain.length - 1]!.v;
    now.rain_24h = series.rain.slice(-24).reduce((s, p) => s + p.v, 0);
  }
  return now;
}

/* ---------- demo data: a stable, plausible week so the page can be judged offline ---------- */

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function demoSeries(lat: number, lon: number, historyHours = 72, forecastHours = 48): {
  history: Series;
  forecast: Series;
} {
  const rand = seeded(Math.round(Math.abs(lat * 1000) + Math.abs(lon * 1000)));
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const summer = Math.abs(lat) < 50;
  const baseT = summer ? 24 : 12;
  const history: Series = { t: [], rh: [], p: [], wind: [], rain: [], pm25: [] };
  const forecast: Series = { t: [], rh: [], p: [], wind: [], rain: [], pm25: [] };
  const total = historyHours + forecastHours;
  let smoke = 6 + rand() * 4;
  for (let i = 0; i < total; i += 1) {
    const d = new Date(start.getTime() + (i - historyHours) * 3600_000);
    const hour = d.getHours();
    const diurnal = Math.sin(((hour - 9) / 24) * Math.PI * 2);
    const trend = i / total; // warming through the window
    const t = baseT + 7 * diurnal + 5 * trend + (rand() - 0.5) * 1.2;
    const rh = Math.max(8, Math.min(95, 55 - 25 * diurnal - 18 * trend + (rand() - 0.5) * 6));
    const wind = Math.max(0, 3 + 4 * Math.max(0, diurnal) + 8 * Math.max(0, trend - 0.6) + (rand() - 0.5) * 2);
    const rain = i % 37 === 20 ? 6 + rand() * 10 : rand() > 0.96 ? rand() * 2 : 0;
    smoke = Math.max(3, smoke + (rand() - 0.48) * 4 + (trend > 0.7 ? 1.5 : 0));
    const p = 1012 - 4 * trend + 1.5 * Math.sin((i / 24) * Math.PI * 2) + (rand() - 0.5) * 0.6;
    const target = i < historyHours ? history : forecast;
    const stamp = d.toISOString();
    target.t!.push({ t: stamp, v: Number(t.toFixed(1)) });
    target.rh!.push({ t: stamp, v: Number(rh.toFixed(0)) });
    target.p!.push({ t: stamp, v: Number(p.toFixed(1)) });
    target.wind!.push({ t: stamp, v: Number(wind.toFixed(1)) });
    target.rain!.push({ t: stamp, v: Number(rain.toFixed(1)) });
    target.pm25!.push({ t: stamp, v: Number(smoke.toFixed(1)) });
  }
  return { history, forecast };
}

export function backendLabel(id: BackendId): string {
  return BACKENDS.find((b) => b.id === id)?.name ?? id;
}
