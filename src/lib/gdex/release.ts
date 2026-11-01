/**
 * Builds one GDEX-ready release: every consenting station's readings for a calendar month or quarter.
 *
 * What GDEX asked for (Riley Conroy, NCAR CISL DECS): do nothing bizarre. No dates as strings, always
 * coordinates, always descriptive metadata, and CF-compliant if possible. So a release is:
 *
 *   - <id>.nc            CF-1.8 + ACDD-1.3 NetCDF. Time is numeric ("seconds since 1970-01-01 00:00:00"),
 *                        every station has latitude/longitude/altitude, every variable has units and a
 *                        long_name (plus a standard_name where one fits). One file, all stations,
 *                        stored as a contiguous ragged array (CF section 9.3.4, featureType timeSeries).
 *   - <id>.csv           The same observations for people who open files in a spreadsheet. Time is numeric.
 *   - <id>_metadata.json Dataset, station and variable description, the quality report, and the
 *                        fields the GDEX submission form asks for.
 *   - SHA256SUMS         Checksums for the files above, for `sha256sum -c`.
 *
 * This module is pure (no database, no network): give it stations and rows, get files and a report.
 */
import { cfFor, ncName, type CfVariable } from "./cf.ts";
import { FILL_FLOAT, parseNetcdf3, writeNetcdf3, type NcAttr, type NcVariable } from "./netcdf.ts";
import { isoSeconds, type Cadence, type Period } from "./period.ts";

export type DatasetInfo = {
  /** Short stable identifier, used in file names and the dataset `id`. */
  slug: string;
  title: string;
  summary: string;
  institution: string;
  creatorName: string;
  creatorEmail: string;
  creatorUrl: string;
  /** Who GDEX should contact about this dataset. */
  contactName: string;
  contactEmail: string;
  license: string;
  keywords: string[];
  namingAuthority: string;
  updateFrequency: Cadence;
  /** Written into every file so a reader can tell which builder made it. */
  softwareVersion: string;
  references: string;
  acknowledgement: string;
  /** How many decimals latitude and longitude keep. 3 is about 110 m: a neighbourhood, not a rooftop. */
  coordinateDecimals: number;
};

export type StationInfo = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  steward: string;
  license: string;
};

export type Observation = { t: number; values: Record<string, number> };

export type Issue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  station?: string;
  variable?: string;
};

export type ReleaseFile = { name: string; contentType: string; data: Uint8Array; sha256: string };

export type VariableSummary = {
  name: string;
  longName: string;
  standardName: string | null;
  units: string;
  count: number;
  min: number;
  max: number;
  mapped: boolean;
  stationCount: number;
};

export type StationSummary = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  rows: number;
  first: string | null;
  last: string | null;
  steward: string;
  license: string;
};

export type BuiltRelease = {
  period: { id: string; label: string; start: string; end: string };
  files: ReleaseFile[];
  stations: StationSummary[];
  variables: VariableSummary[];
  issues: Issue[];
  rows: number;
  firstTime: string | null;
  lastTime: string | null;
  /** True when there is nothing blocking: no issue has severity "error". */
  ok: boolean;
};

const EPOCH_UNITS = "seconds since 1970-01-01 00:00:00";

async function sha256(data: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** ISO 8601 duration for a number of seconds, like PT5M or PT1H. */
function isoDuration(seconds: number): string {
  if (!(seconds > 0)) return "";
  const s = Math.round(seconds);
  if (s % 3600 === 0) return `PT${s / 3600}H`;
  if (s % 60 === 0) return `PT${s / 60}M`;
  return `PT${s}S`;
}

export function fileBase(dataset: DatasetInfo, period: Period): string {
  return `${dataset.slug}_${period.id}`;
}

/** Checks that do not need any readings: is the dataset described, are the stations placed. */
export function checkDescription(dataset: DatasetInfo, stations: StationInfo[]): Issue[] {
  const issues: Issue[] = [];
  const need: [keyof DatasetInfo, string][] = [
    ["title", "a title"],
    ["summary", "a summary"],
    ["institution", "an institution"],
    ["creatorName", "a creator name"],
    ["creatorEmail", "a creator email"],
    ["license", "a license"],
    ["contactEmail", "a contact email"],
  ];
  for (const [k, what] of need) {
    if (!String(dataset[k] ?? "").trim()) issues.push({ severity: "error", code: "dataset.metadata", message: `The dataset needs ${what}. GDEX does not accept data without descriptive metadata.` });
  }
  if (dataset.keywords.length === 0) issues.push({ severity: "warning", code: "dataset.keywords", message: "The dataset has no keywords." });
  if (stations.length === 0) issues.push({ severity: "error", code: "stations.none", message: "No station is eligible. A station needs to be in the NCAR network, have a location, and have GDEX consent." });
  for (const s of stations) {
    const lat = s.latitude;
    const lon = s.longitude;
    if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      issues.push({ severity: "error", code: "station.location", station: s.id, message: `${s.name}: no valid latitude and longitude. Every GDEX station needs coordinates.` });
    }
    if (s.elevation === null || !Number.isFinite(s.elevation)) {
      issues.push({ severity: "warning", code: "station.elevation", station: s.id, message: `${s.name}: no elevation, so altitude is written as missing.` });
    }
    if (!s.steward.trim()) issues.push({ severity: "error", code: "station.steward", station: s.id, message: `${s.name}: consent needs a named steward.` });
  }
  return issues;
}

export async function buildRelease(input: {
  period: Period;
  dataset: DatasetInfo;
  stations: { info: StationInfo; rows: Observation[] }[];
  now?: Date;
}): Promise<BuiltRelease> {
  const { period, dataset } = input;
  const now = input.now ?? new Date();
  const startS = period.start.getTime() / 1000;
  const endS = period.end.getTime() / 1000;
  const dec = Math.min(6, Math.max(2, Math.round(dataset.coordinateDecimals)));
  const issues = checkDescription(dataset, input.stations.map((s) => s.info));

  // 1. Tidy each station's rows: inside the period, in order, one row per instant, only finite numbers.
  type Clean = { info: StationInfo; rows: Observation[] };
  const clean: Clean[] = [];
  for (const { info, rows } of [...input.stations].sort((a, b) => a.info.id.localeCompare(b.info.id))) {
    const byTime = new Map<number, Record<string, number>>();
    let outside = 0;
    let dupes = 0;
    let bad = 0;
    for (const r of rows) {
      if (!(r.t >= startS && r.t < endS)) {
        outside++;
        continue;
      }
      const values: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.values)) {
        if (Number.isFinite(v)) values[k] = v;
        else bad++;
      }
      if (Object.keys(values).length === 0) continue;
      if (byTime.has(r.t)) {
        dupes++;
        Object.assign(byTime.get(r.t) as Record<string, number>, values);
      } else byTime.set(r.t, values);
    }
    if (outside) issues.push({ severity: "info", code: "rows.outside", station: info.id, message: `${info.name}: ${outside} readings fell outside ${period.label} and were left out.` });
    if (dupes) issues.push({ severity: "warning", code: "rows.duplicate", station: info.id, message: `${info.name}: ${dupes} readings shared a timestamp and were merged.` });
    if (bad) issues.push({ severity: "warning", code: "values.nonfinite", station: info.id, message: `${info.name}: ${bad} values were not numbers and were left out.` });
    const sorted = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, values]) => ({ t, values }));
    if (sorted.length === 0) {
      issues.push({ severity: "info", code: "station.empty", station: info.id, message: `${info.name}: no readings in ${period.label}; it is not in this release.` });
      continue;
    }
    if (sorted.length < 10) issues.push({ severity: "warning", code: "station.sparse", station: info.id, message: `${info.name}: only ${sorted.length} readings in ${period.label}.` });
    clean.push({ info, rows: sorted });
  }

  // Stations that cannot be placed never go in the file, whatever else is true.
  const placeable = clean.filter(({ info }) => info.latitude !== null && info.longitude !== null && Math.abs(info.latitude) <= 90 && Math.abs(info.longitude) <= 180);
  const total = placeable.reduce((a, s) => a + s.rows.length, 0);
  if (total === 0) issues.push({ severity: "error", code: "rows.none", message: `There are no readings from eligible stations in ${period.label}.` });

  // 2. Variables: every measurement name that appears, with its CF description and its range.
  const names = [...new Set(placeable.flatMap((s) => s.rows.flatMap((r) => Object.keys(r.values))))].sort();
  const cf = new Map<string, CfVariable>(names.map((n) => [n, cfFor(n)]));
  const variables: VariableSummary[] = names.map((n) => {
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    const stationsWith = new Set<string>();
    for (const s of placeable)
      for (const r of s.rows) {
        const v = r.values[n];
        if (v === undefined) continue;
        count++;
        stationsWith.add(s.info.id);
        if (v < min) min = v;
        if (v > max) max = v;
      }
    const c = cf.get(n) as CfVariable;
    return { name: ncName(n), longName: c.longName, standardName: c.standardName ?? null, units: c.units, count, min, max, mapped: c.mapped, stationCount: stationsWith.size };
  });
  for (const n of names) {
    const c = cf.get(n) as CfVariable;
    if (!c.mapped) issues.push({ severity: "warning", code: "variable.unmapped", variable: n, message: `${n}: no standard name or units are known, so it is exported with units "1". Add it to src/lib/gdex/cf.ts.` });
    else if (!c.standardName) issues.push({ severity: "info", code: "variable.nostandard", variable: n, message: `${n}: described with long_name and units; no CF standard name fits.` });
    if (c.plausible) {
      let out = 0;
      let example: number | null = null;
      for (const s of placeable)
        for (const r of s.rows) {
          const v = r.values[n];
          if (v !== undefined && (v < c.plausible[0] || v > c.plausible[1])) {
            out++;
            example ??= v;
          }
        }
      if (out) issues.push({ severity: "warning", code: "values.implausible", variable: n, message: `${n}: ${out} values are outside ${c.plausible[0]} to ${c.plausible[1]} ${c.units} (for example ${example}). They are kept; check the sensor.` });
    }
  }

  const errors = issues.some((i) => i.severity === "error");
  const first = total ? Math.min(...placeable.map((s) => s.rows[0].t)) : null;
  const last = total ? Math.max(...placeable.map((s) => s.rows[s.rows.length - 1].t)) : null;
  const stations: StationSummary[] = placeable.map(({ info, rows }) => ({
    id: info.id,
    name: info.name,
    latitude: info.latitude === null ? null : round(info.latitude, dec),
    longitude: info.longitude === null ? null : round(info.longitude, dec),
    altitude: info.elevation === null || !Number.isFinite(info.elevation) ? null : Math.round(info.elevation),
    rows: rows.length,
    first: isoSeconds(new Date(rows[0].t * 1000)),
    last: isoSeconds(new Date(rows[rows.length - 1].t * 1000)),
    steward: info.steward,
    license: info.license,
  }));

  const result: BuiltRelease = {
    period: { id: period.id, label: period.label, start: isoSeconds(period.start), end: isoSeconds(period.end) },
    files: [],
    stations,
    variables,
    issues,
    rows: total,
    firstTime: first === null ? null : isoSeconds(new Date(first * 1000)),
    lastTime: last === null ? null : isoSeconds(new Date(last * 1000)),
    ok: !errors,
  };
  if (total === 0) return result;

  // 3. Files.
  const base = fileBase(dataset, period);
  const enc = (s: string) => new TextEncoder().encode(s);
  const nc = netcdfFile({ dataset, period, placeable, names, cf, variables, stations, dec, now, first: first as number, last: last as number });
  const csv = enc(csvFile({ dataset, period, placeable, names, cf, stations }));
  const ncHash = await sha256(nc);
  const csvHash = await sha256(csv);

  const meta = enc(
    JSON.stringify(
      metadataRecord({ dataset, period, stations, variables, issues, files: [{ name: `${base}.nc`, sha256: ncHash, size: nc.length }, { name: `${base}.csv`, sha256: csvHash, size: csv.length }], rows: total, first: first as number, last: last as number, now, dec }),
      null,
      2,
    ),
  );
  const metaHash = await sha256(meta);
  const sums = enc(`${ncHash}  ${base}.nc\n${csvHash}  ${base}.csv\n${metaHash}  ${base}_metadata.json\n`);
  result.files = [
    { name: `${base}.nc`, contentType: "application/x-netcdf", data: nc, sha256: ncHash },
    { name: `${base}.csv`, contentType: "text/csv; charset=utf-8", data: csv, sha256: csvHash },
    { name: `${base}_metadata.json`, contentType: "application/json", data: meta, sha256: metaHash },
    { name: "SHA256SUMS", contentType: "text/plain; charset=utf-8", data: sums, sha256: await sha256(sums) },
  ];

  // 4. Read our own NetCDF back: a release is only offered if what was written is what was meant.
  const selfCheck = checkNetcdf(nc, { stations: stations.length, rows: total, variables: variables.map((v) => v.name) });
  for (const message of selfCheck) result.issues.push({ severity: "error", code: "netcdf.selfcheck", message });
  result.ok = !result.issues.some((i) => i.severity === "error");
  return result;
}

type NcInput = {
  dataset: DatasetInfo;
  period: Period;
  placeable: { info: StationInfo; rows: Observation[] }[];
  names: string[];
  cf: Map<string, CfVariable>;
  variables: VariableSummary[];
  stations: StationSummary[];
  dec: number;
  now: Date;
  first: number;
  last: number;
};

function netcdfFile(i: NcInput): Uint8Array {
  const { dataset, period, placeable, names, cf, variables, stations, dec, now, first, last } = i;
  const nStations = placeable.length;
  const nObs = placeable.reduce((a, s) => a + s.rows.length, 0);
  const idLen = Math.max(1, ...placeable.map((s) => new TextEncoder().encode(s.info.id).length));
  const nameLen = Math.max(1, ...placeable.map((s) => new TextEncoder().encode(s.info.name).length));

  const time = new Float64Array(nObs);
  const columns = new Map<string, Float32Array>(names.map((n) => [n, new Float32Array(nObs).fill(FILL_FLOAT)]));
  const rowSize = new Int32Array(nStations);
  let o = 0;
  placeable.forEach((s, si) => {
    rowSize[si] = s.rows.length;
    for (const r of s.rows) {
      time[o] = r.t;
      for (const [k, v] of Object.entries(r.values)) (columns.get(k) as Float32Array)[o] = v;
      o++;
    }
  });

  const lat = Float64Array.from(stations.map((s) => s.latitude as number));
  const lon = Float64Array.from(stations.map((s) => s.longitude as number));
  const alt = Float64Array.from(stations.map((s) => (s.altitude === null ? FILL_FLOAT : s.altitude)));
  const spatial = ["time", "lat", "lon", "alt"].join(" ");

  const vars: NcVariable[] = [
    {
      name: "station_id",
      type: "char",
      dims: ["station", "id_strlen"],
      attrs: { long_name: "station identifier", cf_role: "timeseries_id" },
      data: placeable.map((s) => s.info.id),
    },
    { name: "station_name", type: "char", dims: ["station", "name_strlen"], attrs: { long_name: "station name" }, data: placeable.map((s) => s.info.name) },
    {
      name: "lat",
      type: "double",
      dims: ["station"],
      attrs: { standard_name: "latitude", long_name: "station latitude", units: "degrees_north", axis: "Y", comment: `Rounded to ${dec} decimal places.` },
      data: lat,
    },
    {
      name: "lon",
      type: "double",
      dims: ["station"],
      attrs: { standard_name: "longitude", long_name: "station longitude", units: "degrees_east", axis: "X", comment: `Rounded to ${dec} decimal places.` },
      data: lon,
    },
    {
      name: "alt",
      type: "double",
      dims: ["station"],
      attrs: { standard_name: "altitude", long_name: "station altitude above mean sea level", units: "m", positive: "up", axis: "Z", _FillValue: FILL_FLOAT },
      data: alt,
    },
    {
      name: "row_size",
      type: "int",
      dims: ["station"],
      attrs: { long_name: "number of observations for this station", sample_dimension: "obs" },
      data: rowSize,
    },
    {
      name: "time",
      type: "double",
      dims: ["obs"],
      attrs: { standard_name: "time", long_name: "time of observation (UTC)", units: EPOCH_UNITS, calendar: "standard", axis: "T" },
      data: time,
    },
  ];
  for (const n of names) {
    const c = cf.get(n) as CfVariable;
    const v = variables.find((x) => x.name === ncName(n)) as VariableSummary;
    const attrs: Record<string, NcAttr> = {};
    if (c.standardName) attrs.standard_name = c.standardName;
    attrs.long_name = c.longName;
    attrs.units = c.units;
    attrs.coordinates = spatial;
    attrs._FillValue = { type: "float", value: FILL_FLOAT };
    attrs.actual_range = { type: "float", value: [v.min, v.max] };
    attrs.comment = c.comment ?? "";
    if (!attrs.comment) delete attrs.comment;
    vars.push({ name: ncName(n), type: "float", dims: ["obs"], attrs, data: columns.get(n) as Float32Array });
  }

  const iso = (s: number) => isoSeconds(new Date(s * 1000));
  const lats = stations.map((s) => s.latitude as number);
  const lons = stations.map((s) => s.longitude as number);
  const stepSeconds = median(placeable.flatMap((s) => s.rows.slice(1).map((r, k) => r.t - s.rows[k].t)));
  const attrs: Record<string, NcAttr> = {
    Conventions: "CF-1.8, ACDD-1.3",
    featureType: "timeSeries",
    cdm_data_type: "Station",
    title: `${dataset.title}, ${period.label}`,
    summary: dataset.summary,
    id: fileBase(dataset, period),
    naming_authority: dataset.namingAuthority,
    institution: dataset.institution,
    source: "Community weather and environment stations built from the OpenIoTwx project",
    project: "OpenIoTwx",
    license: dataset.license,
    creator_name: dataset.creatorName,
    creator_email: dataset.creatorEmail,
    creator_url: dataset.creatorUrl,
    keywords: dataset.keywords.join(", "),
    standard_name_vocabulary: "CF Standard Name Table",
    history: `${isoSeconds(now)} Created by OpenIoTwx ${dataset.softwareVersion} (GDEX release builder) from station readings stored in the OpenIoTwx database.`,
    date_created: isoSeconds(now),
    time_coverage_start: iso(first),
    time_coverage_end: iso(last),
    geospatial_lat_min: Math.min(...lats),
    geospatial_lat_max: Math.max(...lats),
    geospatial_lon_min: Math.min(...lons),
    geospatial_lon_max: Math.max(...lons),
    geospatial_lat_units: "degrees_north",
    geospatial_lon_units: "degrees_east",
    number_of_stations: { type: "int", value: nStations },
    product_version: period.id,
    comment: `Station coordinates are rounded to ${dec} decimal places. Only stations whose stewards gave consent are included.`,
  };
  if (stepSeconds > 0) attrs.time_coverage_resolution = isoDuration(stepSeconds);
  if (dataset.references) attrs.references = dataset.references;
  if (dataset.acknowledgement) attrs.acknowledgement = dataset.acknowledgement;

  return writeNetcdf3({ dims: { station: nStations, obs: nObs, id_strlen: idLen, name_strlen: nameLen }, attrs, vars });
}

/** Read a NetCDF back and report anything that does not match what was meant to be written. */
export function checkNetcdf(bytes: Uint8Array, expect: { stations: number; rows: number; variables: string[] }): string[] {
  const out: string[] = [];
  try {
    const f = parseNetcdf3(bytes);
    if (f.dims.station !== expect.stations) out.push(`The file has ${f.dims.station} stations; expected ${expect.stations}.`);
    if (f.dims.obs !== expect.rows) out.push(`The file has ${f.dims.obs} observations; expected ${expect.rows}.`);
    for (const need of ["time", "lat", "lon", "alt", "station_id", "row_size", ...expect.variables]) {
      if (!f.vars.some((v) => v.name === need)) out.push(`The file is missing the variable ${need}.`);
    }
    for (const v of f.vars) {
      if (["station_id", "station_name", "row_size"].includes(v.name)) continue;
      if (typeof v.attrs.units !== "string") out.push(`Variable ${v.name} has no units.`);
      if (typeof v.attrs.long_name !== "string") out.push(`Variable ${v.name} has no long_name.`);
    }
    for (const g of ["Conventions", "title", "summary", "institution", "license", "time_coverage_start", "time_coverage_end"]) {
      if (typeof f.attrs[g] !== "string") out.push(`The file has no global attribute ${g}.`);
    }
    const t = f.read("time") as number[];
    const sizes = f.read("row_size") as number[];
    if (sizes.reduce((a, b) => a + b, 0) !== t.length) out.push("row_size does not add up to the number of observations.");
    let at = 0;
    for (const n of sizes) {
      for (let k = 1; k < n; k++) if (!(t[at + k] > t[at + k - 1])) out.push("Time is not increasing within a station.");
      at += n;
      if (out.length > 5) break;
    }
  } catch (e) {
    out.push(`The NetCDF file could not be read back: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

function csvFile(i: Pick<NcInput, "dataset" | "period" | "placeable" | "names" | "cf" | "stations">): string {
  const { dataset, period, placeable, names, cf, stations } = i;
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines: string[] = [
    `# ${dataset.title}, ${period.label}`,
    `# Conventions: CF-1.8, ACDD-1.3 (this CSV mirrors the NetCDF file of the same name)`,
    `# time_utc_s: seconds since 1970-01-01 00:00:00 UTC (a number, not a date string)`,
    `# latitude, longitude: degrees_north, degrees_east. altitude_m: metres above mean sea level. Missing values are empty.`,
    `# license: ${dataset.license}`,
  ];
  for (const n of names) {
    const c = cf.get(n) as CfVariable;
    lines.push(`# ${ncName(n)}: ${c.longName}${c.standardName ? ` [${c.standardName}]` : ""}, units: ${c.units}`);
  }
  lines.push(["station_id", "latitude", "longitude", "altitude_m", "time_utc_s", ...names.map(ncName)].join(","));
  placeable.forEach((s, si) => {
    const st = stations[si];
    const head = [q(s.info.id), String(st.latitude), String(st.longitude), st.altitude === null ? "" : String(st.altitude)];
    for (const r of s.rows) lines.push([...head, String(r.t), ...names.map((n) => (r.values[n] === undefined ? "" : String(r.values[n])))].join(","));
  });
  return `${lines.join("\n")}\n`;
}

function metadataRecord(i: {
  dataset: DatasetInfo;
  period: Period;
  stations: StationSummary[];
  variables: VariableSummary[];
  issues: Issue[];
  files: { name: string; sha256: string; size: number }[];
  rows: number;
  first: number;
  last: number;
  now: Date;
  dec: number;
}) {
  const { dataset, period, stations, variables, issues, files, rows, first, last, now, dec } = i;
  const lats = stations.map((s) => s.latitude as number);
  const lons = stations.map((s) => s.longitude as number);
  return {
    dataset: {
      id: dataset.slug,
      title: dataset.title,
      summary: dataset.summary,
      keywords: dataset.keywords,
      license: dataset.license,
      institution: dataset.institution,
      creator: { name: dataset.creatorName, email: dataset.creatorEmail, url: dataset.creatorUrl },
      contact: { name: dataset.contactName, email: dataset.contactEmail },
      update_frequency: dataset.updateFrequency,
      references: dataset.references,
      acknowledgement: dataset.acknowledgement,
    },
    release: {
      period: period.id,
      label: period.label,
      start: isoSeconds(period.start),
      end: isoSeconds(period.end),
      created: isoSeconds(now),
      builder: `OpenIoTwx ${dataset.softwareVersion}`,
      observations: rows,
      stations: stations.length,
      time_coverage: { start: isoSeconds(new Date(first * 1000)), end: isoSeconds(new Date(last * 1000)) },
      bounding_box: { lat_min: Math.min(...lats), lat_max: Math.max(...lats), lon_min: Math.min(...lons), lon_max: Math.max(...lons) },
      coordinate_decimals: dec,
    },
    format: {
      files: files,
      netcdf: "NetCDF-3 classic, CF-1.8 + ACDD-1.3, featureType timeSeries, contiguous ragged array (CF 9.3.4)",
      time: `Numeric: ${EPOCH_UNITS} (UTC, standard calendar)`,
      missing_value: "_FillValue 9.969209968386869e36 in NetCDF; empty cells in the CSV",
      netcdf4: "Run infra/services/gdex_publisher/netcdf4_convert.py for NetCDF-4 with compression and chunking.",
    },
    variables,
    stations,
    quality_report: {
      errors: issues.filter((x) => x.severity === "error").length,
      warnings: issues.filter((x) => x.severity === "warning").length,
      issues,
    },
    gdex_submission: {
      note: "These are the details the GDEX data-submission form asks for (https://gdex.ucar.edu/resources/submit-data/).",
      title: dataset.title,
      abstract: dataset.summary,
      data_format: "NetCDF (CF-1.8), with CSV copies",
      update_frequency: dataset.updateFrequency === "monthly" ? "monthly releases" : "quarterly releases",
      license: dataset.license,
      contact: dataset.contactEmail,
      temporal_start: isoSeconds(new Date(first * 1000)),
      spatial_extent: { lat_min: Math.min(...lats), lat_max: Math.max(...lats), lon_min: Math.min(...lons), lon_max: Math.max(...lons) },
    },
  };
}
