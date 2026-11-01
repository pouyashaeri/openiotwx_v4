import { pctile } from "./format.ts";

/**
 * CDC/ATSDR Social Vulnerability Index, 2022 release. Read straight from the official
 * feature service (the layer behind the ArcGIS item linked in the brief), one tract at a time.
 * Percentiles run 0–1; higher means more vulnerable. Flags mark the top 10% nationally.
 */

export const SVI_SERVICE =
  "https://services3.arcgis.com/ZvidGQkLaDJxRSJ2/ArcGIS/rest/services/CDC_ATSDR_Social_Vulnerability_Index_2022_USA/FeatureServer";
export const SVI_TRACT_LAYER = 2;
export const SVI_COUNTY_LAYER = 1;

export type SviTheme = { id: "theme1" | "theme2" | "theme3" | "theme4"; label: string; rank: number; flags: number };

export type SviFactor = {
  id: string;
  label: string;
  /** Percent of people or households in the tract. */
  percent: number | null;
  /** National percentile, 0–1. */
  rank: number | null;
  flagged: boolean;
  theme: SviTheme["id"];
};

export type SviProfile = {
  fips: string;
  location: string;
  county: string;
  state: string;
  population: number | null;
  overall: number;
  flagsTotal: number;
  themes: SviTheme[];
  factors: SviFactor[];
  fetchedAt: string;
  source: "cdc";
};

type Attr = Record<string, number | string | null>;

const FACTORS: Array<{ id: string; label: string; theme: SviTheme["id"] }> = [
  { id: "POV150", label: "Below 150% of poverty", theme: "theme1" },
  { id: "UNEMP", label: "Unemployed", theme: "theme1" },
  { id: "HBURD", label: "Housing cost burdened", theme: "theme1" },
  { id: "NOHSDP", label: "No high school diploma", theme: "theme1" },
  { id: "UNINSUR", label: "Uninsured", theme: "theme1" },
  { id: "AGE65", label: "Aged 65 and older", theme: "theme2" },
  { id: "AGE17", label: "Aged 17 and younger", theme: "theme2" },
  { id: "DISABL", label: "Living with a disability", theme: "theme2" },
  { id: "SNGPNT", label: "Single-parent households", theme: "theme2" },
  { id: "LIMENG", label: "Limited English", theme: "theme2" },
  { id: "MINRTY", label: "Racial and ethnic minority", theme: "theme3" },
  { id: "MUNIT", label: "Multi-unit housing", theme: "theme4" },
  { id: "MOBILE", label: "Mobile homes", theme: "theme4" },
  { id: "CROWD", label: "Crowded households", theme: "theme4" },
  { id: "NOVEH", label: "No vehicle", theme: "theme4" },
  { id: "GROUPQ", label: "Group quarters", theme: "theme4" },
];

export const THEME_LABELS: Record<SviTheme["id"], string> = {
  theme1: "Socioeconomic status",
  theme2: "Household characteristics",
  theme3: "Racial and ethnic minority status",
  theme4: "Housing type and transportation",
};

const OUT_FIELDS = [
  "FIPS",
  "LOCATION",
  "COUNTY",
  "ST_ABBR",
  "E_TOTPOP",
  "RPL_THEMES",
  "RPL_THEME1",
  "RPL_THEME2",
  "RPL_THEME3",
  "RPL_THEME4",
  "F_TOTAL",
  "F_THEME1",
  "F_THEME2",
  "F_THEME3",
  "F_THEME4",
  ...FACTORS.flatMap((f) => [`EP_${f.id}`, `EPL_${f.id}`, `F_${f.id}`]),
];

function num(a: Attr, key: string): number | null {
  const v = a[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null; // -999 marks no data
  return v;
}

export function sviQueryUrl(lat: number, lon: number, layer = SVI_TRACT_LAYER): string {
  const params = new URLSearchParams({
    f: "json",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: OUT_FIELDS.join(","),
    returnGeometry: "false",
  });
  return `${SVI_SERVICE}/${layer}/query?${params.toString()}`;
}

export function parseSvi(attributes: Attr): SviProfile | null {
  const overall = num(attributes, "RPL_THEMES");
  if (overall === null) return null;
  const themes: SviTheme[] = (["theme1", "theme2", "theme3", "theme4"] as const).map((id, i) => ({
    id,
    label: THEME_LABELS[id],
    rank: num(attributes, `RPL_THEME${i + 1}`) ?? 0,
    flags: num(attributes, `F_THEME${i + 1}`) ?? 0,
  }));
  return {
    fips: String(attributes.FIPS ?? ""),
    location: String(attributes.LOCATION ?? ""),
    county: String(attributes.COUNTY ?? ""),
    state: String(attributes.ST_ABBR ?? ""),
    population: num(attributes, "E_TOTPOP"),
    overall,
    flagsTotal: num(attributes, "F_TOTAL") ?? 0,
    themes,
    factors: FACTORS.map((f) => ({
      id: f.id,
      label: f.label,
      theme: f.theme,
      percent: num(attributes, `EP_${f.id}`),
      rank: num(attributes, `EPL_${f.id}`),
      flagged: num(attributes, `F_${f.id}`) === 1,
    })),
    fetchedAt: new Date().toISOString(),
    source: "cdc",
  };
}

export async function fetchSvi(lat: number, lon: number): Promise<SviProfile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(sviQueryUrl(lat, lon), { signal: controller.signal });
    if (!response.ok) return null;
    const json = (await response.json()) as { features?: Array<{ attributes: Attr }>; error?: unknown };
    const first = json.features?.[0]?.attributes;
    return first ? parseSvi(first) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Words for a percentile, the way the SVI map legend bands them. */
export function rankBand(rank: number | null): { label: string; level: 0 | 1 | 2 | 3 } {
  if (rank === null) return { label: "No data", level: 0 };
  if (rank > 0.75) return { label: "High", level: 3 };
  if (rank > 0.5) return { label: "Moderate to high", level: 2 };
  if (rank > 0.25) return { label: "Low to moderate", level: 1 };
  return { label: "Low", level: 0 };
}

export function pct(rank: number | null): string {
  return pctile(rank);
}

/** A plausible profile for the demo, so the layout can be judged before any network call. */
export function demoSvi(label: string): SviProfile {
  const base: Attr = {
    FIPS: "00000000000",
    LOCATION: `Sample tract near ${label || "your site"}`,
    COUNTY: "Sample County",
    ST_ABBR: "US",
    E_TOTPOP: 4120,
    RPL_THEMES: 0.71,
    RPL_THEME1: 0.64,
    RPL_THEME2: 0.58,
    RPL_THEME3: 0.77,
    RPL_THEME4: 0.69,
    F_TOTAL: 2,
    F_THEME1: 0,
    F_THEME2: 1,
    F_THEME3: 0,
    F_THEME4: 1,
  };
  const sample: Record<string, [number, number, number]> = {
    POV150: [31.2, 0.68, 0],
    UNEMP: [6.1, 0.55, 0],
    HBURD: [38.4, 0.62, 0],
    NOHSDP: [12.3, 0.57, 0],
    UNINSUR: [9.8, 0.6, 0],
    AGE65: [19.5, 0.63, 0],
    AGE17: [22.1, 0.41, 0],
    DISABL: [17.9, 0.9, 1],
    SNGPNT: [8.2, 0.52, 0],
    LIMENG: [6.4, 0.71, 0],
    MINRTY: [44.0, 0.77, 0],
    MUNIT: [21.0, 0.74, 0],
    MOBILE: [11.6, 0.9, 1],
    CROWD: [3.1, 0.55, 0],
    NOVEH: [7.0, 0.52, 0],
    GROUPQ: [1.0, 0.44, 0],
  };
  for (const [id, [p, r, f]] of Object.entries(sample)) {
    base[`EP_${id}`] = p;
    base[`EPL_${id}`] = r;
    base[`F_${id}`] = f;
  }
  return parseSvi(base)!;
}
