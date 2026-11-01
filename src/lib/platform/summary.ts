/**
 * A plain-language "right now" summary of a station's latest readings. It replaces the legacy
 * model_service for the station page: same idea (current conditions in a few sentences, no
 * invented data), but deterministic, instant and free of an LLM dependency.
 */
type Values = Record<string, { v: number; t: string }>;

const pick = (values: Values, ...names: string[]): number | null => {
  for (const n of names) {
    const hit = Object.keys(values).find((k) => !k.includes("globe") && (k === n || k.endsWith(`_${n}`)));
    if (hit) return values[hit].v;
  }
  return null;
};

const r = (n: number, d = 0) => n.toFixed(d);

function feels(c: number): string {
  if (c < -10) return "bitterly cold";
  if (c < 0) return "freezing";
  if (c < 10) return "cold";
  if (c < 18) return "cool";
  if (c < 25) return "mild";
  if (c < 31) return "warm";
  if (c < 38) return "hot";
  return "dangerously hot";
}

function airQuality(pm25: number): string {
  if (pm25 <= 9) return "good";
  if (pm25 <= 35.4) return "moderate";
  if (pm25 <= 55.4) return "unhealthy for sensitive groups";
  if (pm25 <= 150.4) return "unhealthy";
  return "very unhealthy";
}

export function summarize(values: Values): string[] {
  const out: string[] = [];
  const temp = pick(values, "temp_c", "temperature", "tmp");
  const hum = pick(values, "humidity_pct", "relative_humidity", "rh");
  const wind = pick(values, "wind_ms", "ws");
  const rain = pick(values, "rain_mm", "rainfall_total", "rain_intensity");
  const pm25 = pick(values, "pm25_ugm3", "pm25_standard");
  const co2 = pick(values, "co2_ppm", "co2_concentration");
  const mrt = pick(values, "mrt_c", "mrt");

  if (temp !== null) {
    out.push(`It is ${feels(temp)} at ${r(temp, 1)} °C${hum !== null ? ` with ${r(hum)}% humidity` : ""}.`);
  } else if (hum !== null) {
    out.push(`Humidity is ${r(hum)}%.`);
  }
  if (mrt !== null) {
    out.push(`Mean radiant temperature is ${r(mrt, 1)} °C${temp !== null ? `, ${mrt > temp + 1 ? "higher" : mrt < temp - 1 ? "lower" : "close to"} than the air temperature` : ""}.`);
  }
  if (wind !== null) out.push(wind < 0.5 ? "The air is calm." : `Wind is ${wind < 3 ? "light" : wind < 8 ? "moderate" : "strong"} at ${r(wind, 1)} m/s.`);
  if (rain !== null && rain > 0) out.push(`Rain recorded: ${r(rain, 1)} mm.`);
  if (pm25 !== null) out.push(`Air quality looks ${airQuality(pm25)} (PM2.5 ${r(pm25, 1)} µg/m³).`);
  if (co2 !== null) out.push(`CO₂ is ${r(co2)} ppm${co2 > 1000 ? ", which suggests poor ventilation" : ""}.`);
  return out;
}
