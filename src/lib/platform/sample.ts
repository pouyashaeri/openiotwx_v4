/**
 * The one example reading shown next to a station's settings, and the command that sends it.
 * The numbers are believable (not zeros) so a first test upload looks like real weather on the charts.
 */
const TYPICAL: Record<string, number> = {
  temp_c: 21.4,
  humidity_pct: 48,
  pressure_hpa: 1012,
  rain_mm: 0,
  wind_ms: 3.2,
  wind_dir_deg: 270,
  soil_moisture_pct: 31,
  soil_temp_c: 17.8,
  pm25_ugm3: 8,
  pm10_ugm3: 14,
  co2_ppm: 425,
  o3_ppb: 32,
  uv_index: 4,
};

/** One value for each of the station's metrics. A metric with no typical value gets 1. */
export function sampleValues(metrics: string[]): Record<string, number> {
  return Object.fromEntries(metrics.map((m) => [m, TYPICAL[m] ?? 1]));
}

/**
 * One command that uploads one reading. On Windows it is the PowerShell form (`curl.exe`, because plain
 * `curl` there is another command that rejects these options); everywhere else it is the usual curl.
 */
export function ingestCommand(opts: { origin: string; key: string; values: Record<string, number>; windows: boolean }): string {
  const url = `${opts.origin}/api/ingest`;
  const body = JSON.stringify({ values: opts.values });
  if (opts.windows) {
    return `curl.exe -X POST ${url} \`\n  -H "x-api-key: ${opts.key}" -H "content-type: application/json" \`\n  -d '${body.replace(/"/g, '\\"')}'`;
  }
  return `curl -X POST ${url} \\\n  -H "x-api-key: ${opts.key}" -H "content-type: application/json" \\\n  -d '${body}'`;
}

/** What to call the shell the command is written for, so the label says where to paste it. */
export function shellName(windows: boolean): string {
  return windows ? "PowerShell" : "Terminal";
}
