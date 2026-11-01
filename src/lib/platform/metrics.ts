import type { MeasureId } from "../wizard/types.ts";

export type MetricInfo = { key: string; label: string; unit: string };

/** What each wizard "measure" turns into on the wire. */
export const MEASURE_METRICS: Record<MeasureId, MetricInfo[]> = {
  air: [
    { key: "temp_c", label: "Air temperature", unit: "°C" },
    { key: "humidity_pct", label: "Humidity", unit: "%" },
    { key: "pressure_hpa", label: "Pressure", unit: "hPa" },
  ],
  rain: [{ key: "rain_mm", label: "Rain", unit: "mm" }],
  wind: [
    { key: "wind_ms", label: "Wind speed", unit: "m/s" },
    { key: "wind_dir_deg", label: "Wind direction", unit: "°" },
  ],
  soil: [
    { key: "soil_moisture_pct", label: "Soil moisture", unit: "%" },
    { key: "soil_temp_c", label: "Soil temperature", unit: "°C" },
  ],
  pm: [
    { key: "pm25_ugm3", label: "PM2.5", unit: "µg/m³" },
    { key: "pm10_ugm3", label: "PM10", unit: "µg/m³" },
  ],
  co2: [{ key: "co2_ppm", label: "CO₂", unit: "ppm" }],
  ozone: [{ key: "o3_ppb", label: "Ozone", unit: "ppb" }],
  sun: [{ key: "uv_index", label: "UV index", unit: "" }],
};

const ALL = Object.values(MEASURE_METRICS).flat();

/**
 * Names the legacy Pi gateway sends, as `<sensor>_<measurement>` (for example `bme680_temperature`).
 * They are matched by the measurement part so any sensor gets a readable label.
 */
const GATEWAY_LABELS: [string, string, string][] = [
  ["globe_temperature", "Globe temperature", "°C"],
  ["globe_humidity", "Globe humidity", "%"],
  ["relative_humidity", "Humidity", "%"],
  ["temperature", "Air temperature", "°C"],
  ["pressure", "Pressure", "hPa"],
  ["co2_concentration", "CO₂", "ppm"],
  ["uv_light", "UV light", ""],
  ["ambient_light", "Ambient light", "lux"],
  ["pm10_standard", "PM1.0", "µg/m³"],
  ["pm25_standard", "PM2.5", "µg/m³"],
  ["pm100_standard", "PM10", "µg/m³"],
  ["rainfall_total", "Rain total", "mm"],
  ["rain_intensity", "Rain intensity", "mm/h"],
  ["gas_resistance", "Gas resistance", "Ω"],
  ["mrt", "Mean radiant temperature", "°C"],
  ["ws", "Wind speed", "m/s"],
  ["wd", "Wind direction", "°"],
];

export function metricInfo(key: string): MetricInfo {
  const known = ALL.find((m) => m.key === key);
  if (known) return known;
  const hit = GATEWAY_LABELS.find(([m]) => key === m || key.endsWith(`_${m}`));
  return hit ? { key, label: hit[1], unit: hit[2] } : { key, label: key, unit: "" };
}

export function metricsForMeasures(measures: MeasureId[]): string[] {
  return measures.flatMap((id) => MEASURE_METRICS[id]?.map((m) => m.key) ?? []);
}

/** Ingest accepts any metric name of this shape, so new sensors need no schema change. */
export const METRIC_NAME = /^[a-z][a-z0-9_]{0,39}$/;

export type Range = "6h" | "24h" | "7d" | "30d" | "1y";
export const RANGES: Record<Range, { label: string; hours: number }> = {
  "6h": { label: "6 hours", hours: 6 },
  "24h": { label: "24 hours", hours: 24 },
  "7d": { label: "7 days", hours: 24 * 7 },
  "30d": { label: "30 days", hours: 24 * 30 },
  "1y": { label: "1 year", hours: 24 * 365 },
};
