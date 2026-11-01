import { api } from "@/lib/connect/api";

/**
 * EJScreen environmental-justice indicators for a point and buffer. The data is EJScreen v2.2
 * served by the EJAM API that Public Environmental Data Partners maintain (see
 * https://ejanalysis.com/status). The browser asks the API directly first; if the request is
 * blocked or slow, the community server proxies it. Percentiles are national, 0–100.
 */

export type EjIndicator = {
  code: string;
  label: string;
  value: number;
  unit?: string;
  usPercentile: number | null;
  statePercentile: number | null;
  ejIndexPercentile: number | null;
};

export type EjDemographic = {
  code: string;
  label: string;
  percent: number;
  usPercentile: number | null;
};

export type EjProfile = {
  valid: boolean;
  note?: string;
  bufferMiles: number;
  population: number | null;
  state: string | null;
  demographicIndexPercentile: number | null;
  supplementalIndexPercentile: number | null;
  environmental: EjIndicator[];
  demographic: EjDemographic[];
  reportUrl: string | null;
  fetchedAt: string;
  source: "ejam" | "server" | "demo";
};

export const ENV_INDICATORS: ReadonlyArray<{ code: string; label: string; unit?: string }> = [
  { code: "pm", label: "Fine particles (PM2.5)", unit: "µg/m³" },
  { code: "o3", label: "Ozone", unit: "ppb" },
  { code: "no2", label: "Nitrogen dioxide", unit: "ppb" },
  { code: "dpm", label: "Diesel particulate matter", unit: "µg/m³" },
  { code: "traffic.score", label: "Traffic proximity" },
  { code: "pctpre1960", label: "Lead paint (pre-1960 housing)" },
  { code: "proximity.npl", label: "Superfund proximity" },
  { code: "proximity.rmp", label: "Chemical facility (RMP) proximity" },
  { code: "proximity.tsdf", label: "Hazardous waste proximity" },
  { code: "proximity.npdes", label: "Wastewater discharge" },
  { code: "ust", label: "Underground storage tanks" },
  { code: "drinking", label: "Drinking water non-compliance" },
  { code: "rsei", label: "Toxic releases to air" },
];

export const DEMOG_INDICATORS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "pctlowinc", label: "Low income" },
  { code: "pctmin", label: "People of color" },
  { code: "pctlingiso", label: "Limited English households" },
  { code: "pctlths", label: "Less than high school" },
  { code: "pctunder5", label: "Under age 5" },
  { code: "pctover64", label: "Over age 64" },
];

type Row = Record<string, unknown>;

function num(row: Row, key: string): number | null {
  const v = row[key];
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeEj(row: Row, bufferMiles: number, source: EjProfile["source"]): EjProfile {
  const population = num(row, "pop");
  const valid = population !== null && population >= 0;
  const environmental: EjIndicator[] = [];
  for (const def of ENV_INDICATORS) {
    const value = num(row, def.code);
    if (value === null) continue;
    environmental.push({
      code: def.code,
      label: def.label,
      value,
      unit: def.unit,
      usPercentile: num(row, `pctile.${def.code}`),
      statePercentile: num(row, `state.pctile.${def.code}`),
      ejIndexPercentile: num(row, `pctile.EJ.DISPARITY.${def.code}.eo`),
    });
  }
  const demographic: EjDemographic[] = [];
  for (const def of DEMOG_INDICATORS) {
    const fraction = num(row, def.code);
    if (fraction === null) continue;
    demographic.push({
      code: def.code,
      label: def.label,
      percent: Math.round(fraction * 1000) / 10,
      usPercentile: num(row, `pctile.${def.code}`),
    });
  }
  const link = typeof row["EJAM Report"] === "string" ? row["EJAM Report"] : "";
  const match = link.match(/href="([^"]+)"/i);
  return {
    valid,
    note: valid ? undefined : "The point is outside EJScreen coverage, or the service returned no rows.",
    bufferMiles,
    population,
    state: typeof row.ST === "string" ? row.ST : null,
    demographicIndexPercentile: num(row, "pctile.Demog.Index"),
    supplementalIndexPercentile: num(row, "pctile.Demog.Index.Supp"),
    environmental,
    demographic,
    reportUrl: match?.[1] ?? null,
    fetchedAt: new Date().toISOString(),
    source,
  };
}

async function fromEjam(base: string, lat: number, lon: number, buffer: number): Promise<Row | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sites: [{ lat, lon }], buffer }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (/^\s*</.test(text)) return null;
    const parsed = JSON.parse(text) as unknown;
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    return row && typeof row === "object" ? (row as Row) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchEj(
  lat: number,
  lon: number,
  options: { ejamUrl: string; apiUrl: string; bufferMiles?: number },
): Promise<EjProfile | null> {
  const buffer = options.bufferMiles ?? 1;
  const direct = await fromEjam(options.ejamUrl, lat, lon, buffer);
  if (direct) return normalizeEj(direct, buffer, "ejam");
  const proxied = await api.ej(options.apiUrl, lat, lon);
  if (proxied.ok && proxied.data && typeof proxied.data === "object") {
    return normalizeEj(proxied.data, buffer, "server");
  }
  return null;
}

/** The address of the public EJScreen community report for a point, for people who want the PDF. */
export function ejscreenMapUrl(lat: number, lon: number): string {
  return `https://pedp-ejscreen.azurewebsites.net/?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
}

export function demoEj(): EjProfile {
  const row: Row = {
    pop: 5860,
    ST: "US",
    "pctile.Demog.Index": 74,
    "pctile.Demog.Index.Supp": 69,
    pm: 8.9,
    "pctile.pm": 76,
    "state.pctile.pm": 81,
    "pctile.EJ.DISPARITY.pm.eo": 72,
    o3: 66.2,
    "pctile.o3": 88,
    "state.pctile.o3": 71,
    "pctile.EJ.DISPARITY.o3.eo": 80,
    no2: 11.4,
    "pctile.no2": 64,
    "state.pctile.no2": 70,
    "pctile.EJ.DISPARITY.no2.eo": 61,
    dpm: 0.21,
    "pctile.dpm": 58,
    "state.pctile.dpm": 63,
    "pctile.EJ.DISPARITY.dpm.eo": 55,
    "traffic.score": 410,
    "pctile.traffic.score": 69,
    "state.pctile.traffic.score": 73,
    "pctile.EJ.DISPARITY.traffic.score.eo": 66,
    pctpre1960: 0.31,
    "pctile.pctpre1960": 62,
    "state.pctile.pctpre1960": 58,
    "pctile.EJ.DISPARITY.pctpre1960.eo": 60,
    "proximity.npl": 0.08,
    "pctile.proximity.npl": 44,
    "state.pctile.proximity.npl": 40,
    "pctile.EJ.DISPARITY.proximity.npl.eo": 46,
    "proximity.rmp": 0.4,
    "pctile.proximity.rmp": 51,
    "state.pctile.proximity.rmp": 49,
    "pctile.EJ.DISPARITY.proximity.rmp.eo": 52,
    "proximity.tsdf": 0.9,
    "pctile.proximity.tsdf": 57,
    "state.pctile.proximity.tsdf": 50,
    "pctile.EJ.DISPARITY.proximity.tsdf.eo": 59,
    "proximity.npdes": 0.02,
    "pctile.proximity.npdes": 38,
    "state.pctile.proximity.npdes": 35,
    "pctile.EJ.DISPARITY.proximity.npdes.eo": 40,
    ust: 2.1,
    "pctile.ust": 60,
    "state.pctile.ust": 55,
    "pctile.EJ.DISPARITY.ust.eo": 58,
    drinking: 0,
    "pctile.drinking": 30,
    "state.pctile.drinking": 28,
    "pctile.EJ.DISPARITY.drinking.eo": 31,
    rsei: 1200,
    "pctile.rsei": 47,
    "state.pctile.rsei": 45,
    "pctile.EJ.DISPARITY.rsei.eo": 49,
    pctlowinc: 0.38,
    "pctile.pctlowinc": 71,
    pctmin: 0.46,
    "pctile.pctmin": 63,
    pctlingiso: 0.07,
    "pctile.pctlingiso": 70,
    pctlths: 0.13,
    "pctile.pctlths": 58,
    pctunder5: 0.06,
    "pctile.pctunder5": 52,
    pctover64: 0.19,
    "pctile.pctover64": 66,
  };
  return normalizeEj(row, 1, "demo");
}
