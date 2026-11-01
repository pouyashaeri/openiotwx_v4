/**
 * A deliberately simple local forecast, used until a real CREDIT run is loaded.
 * It is NOT a weather model: it repeats yesterday's daily cycle from the same
 * hour and eases from the latest reading toward it. Pure functions, no I/O.
 */
export type Pt = { t: string; avg: number };

const HOUR = 3600_000;

/** Mean value per whole hour, keyed by epoch-hour. */
function hourly(points: Pt[]): Map<number, number> {
  const sums = new Map<number, { s: number; n: number }>();
  for (const p of points) {
    const h = Math.floor(new Date(p.t).getTime() / HOUR);
    const cur = sums.get(h) ?? { s: 0, n: 0 };
    cur.s += p.avg;
    cur.n += 1;
    sums.set(h, cur);
  }
  return new Map([...sums].map(([h, { s, n }]) => [h, s / n]));
}

/**
 * Forecast `hoursAhead` hours past the last point. Needs at least a few hours of
 * history; returns [] otherwise. With a full day of history it follows the daily
 * cycle; with less it holds the latest value.
 */
export function standInForecast(points: Pt[], hoursAhead = 24): Pt[] {
  if (points.length < 3) return [];
  const byHour = hourly(points);
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  const lastH = hours[hours.length - 1];
  const last = byHour.get(lastH)!;
  const yesterdayAtLast = byHour.get(lastH - 24);
  const out: Pt[] = [];
  for (let h = 1; h <= hoursAhead; h += 1) {
    const base = byHour.get(lastH + h - 24);
    const value =
      base !== undefined && yesterdayAtLast !== undefined
        ? base + (last - yesterdayAtLast) * Math.exp(-h / 6) // today's offset fades out
        : last;
    out.push({ t: new Date((lastH + h) * HOUR).toISOString(), avg: value });
  }
  return out;
}

/**
 * The names a CREDIT run uses (the Mesonet example's forecast files: time, latitude,
 * longitude, temperature, humidity, pressure, wind_speed, wind_direction) next to ours.
 */
export const CREDIT_ALIASES: Record<string, string[]> = {
  temp_c: ["temperature"],
  humidity_pct: ["humidity"],
  pressure_hpa: ["pressure"],
  wind_ms: ["wind_speed"],
  wind_dir_deg: ["wind_direction"],
};

const LOCATION_KEYS = new Set(["latitude", "longitude", "lat", "lon", "euc_dist"]);

export type Place = { lat: number; lon: number };

/** Longitudes in a model grid run 0–360; stations use −180–180. */
const wrapLon = (lon: number) => (lon > 180 ? lon - 360 : lon);

/**
 * Turn a forecast file into one series for this station and variable.
 *
 * Two shapes are understood:
 *  - one row per time with a column for the variable (a station series), and
 *  - a gridded file: many rows per time, each with latitude and longitude. The
 *    row nearest the station is used for each time, as the Mesonet pipeline does.
 *
 * The variable is the column named like ours, or like the model's (see
 * CREDIT_ALIASES). With neither, a file with exactly one value column is taken as
 * that variable; with several it is ambiguous and nothing is returned, rather than
 * quietly plotting the wrong column.
 */
export function forecastFromObservations(
  obs: { t: number; values: Record<string, number> }[],
  metric: string,
  at?: Place,
): Pt[] {
  const names = [metric, ...(CREDIT_ALIASES[metric] ?? [])];
  const valueKeys = [...new Set(obs.flatMap((o) => Object.keys(o.values)))].filter((k) => !LOCATION_KEYS.has(k));
  const key = names.find((n) => valueKeys.includes(n)) ?? (valueKeys.length === 1 ? valueKeys[0] : null);
  if (!key) return [];

  // Group by time, then take the grid point nearest the station when there are several.
  const byTime = new Map<number, { t: number; values: Record<string, number> }[]>();
  for (const o of obs) byTime.set(o.t, [...(byTime.get(o.t) ?? []), o]);
  const out: Pt[] = [];
  for (const [t, rows] of byTime) {
    let row = rows[0];
    if (rows.length > 1) {
      const located = rows.filter((r) => Number.isFinite(r.values.latitude) && Number.isFinite(r.values.longitude));
      if (!at || !located.length) return []; // many points but no way to choose one
      row = located.reduce((best, r) => {
        const d = (x: typeof r) => Math.hypot(x.values.latitude - at.lat, wrapLon(x.values.longitude) - at.lon);
        return d(r) < d(best) ? r : best;
      });
    }
    const v = row.values[key];
    if (Number.isFinite(v)) out.push({ t: new Date(t).toISOString(), avg: v });
  }
  return out.sort((a, b) => (a.t < b.t ? -1 : 1));
}
