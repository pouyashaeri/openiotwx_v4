import assert from "node:assert/strict";
import { test } from "node:test";
import { cfFor, ncName } from "./cf.ts";
import { parseNetcdf3, writeNetcdf3 } from "./netcdf.ts";
import { lastCompletePeriod, parsePeriod, recentPeriods } from "./period.ts";
import { buildRelease, checkDescription, type DatasetInfo, type Observation, type StationInfo } from "./release.ts";

const dataset: DatasetInfo = {
  slug: "openiotwx-network",
  title: "OpenIoTwx community station network",
  summary: "Weather and environment readings from community-built stations.",
  institution: "NSF NCAR",
  creatorName: "OpenIoTwx",
  creatorEmail: "iotwx@example.org",
  creatorUrl: "https://example.org",
  contactName: "Data steward",
  contactEmail: "data@example.org",
  license: "CC BY 4.0",
  keywords: ["weather", "community science"],
  namingAuthority: "openiotwx",
  updateFrequency: "monthly",
  softwareVersion: "test",
  references: "",
  acknowledgement: "",
  coordinateDecimals: 3,
};

const station = (id: string, over: Partial<StationInfo> = {}): StationInfo => ({
  id,
  name: `Station ${id}`,
  latitude: 40.0149876,
  longitude: -105.2705456,
  elevation: 1655.4,
  steward: "A. Steward",
  license: "CC BY 4.0",
  ...over,
});

const OCT = parsePeriod("2026-10")!;
const t0 = OCT.start.getTime() / 1000;
const rows = (n: number, step = 300, extra: Record<string, number> = {}) =>
  Array.from({ length: n }, (_, i) => ({ t: t0 + 3600 + i * step, values: { temp_c: 10 + (i % 7), humidity_pct: 40 + (i % 5), ...extra } }));

test("periods name a fixed stretch of UTC time", () => {
  assert.equal(parsePeriod("2026-10")?.label, "October 2026");
  assert.equal(parsePeriod("2026-10")?.end.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(parsePeriod("2026-Q4")?.start.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(parsePeriod("2026-Q4")?.end.toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(parsePeriod("2026-13"), null);
  assert.equal(lastCompletePeriod("monthly", new Date("2026-11-03T12:00:00Z")).id, "2026-10");
  assert.equal(lastCompletePeriod("monthly", new Date("2027-01-02T00:00:00Z")).id, "2026-12");
  assert.equal(lastCompletePeriod("quarterly", new Date("2027-01-02T00:00:00Z")).id, "2026-Q4");
  assert.deepEqual(recentPeriods("monthly", 3, new Date("2026-11-03T00:00:00Z")).map((p) => p.id), ["2026-10", "2026-09", "2026-08"]);
});

test("the CF table gives units to everything and a standard name where one fits", () => {
  assert.equal(cfFor("temp_c").standardName, "air_temperature");
  assert.equal(cfFor("bme680_temperature").standardName, "air_temperature");
  assert.equal(cfFor("ws302_ws").standardName, "wind_speed");
  assert.equal(cfFor("co2_ppm").units, "1e-6");
  assert.equal(cfFor("mrt_calculated_mrt").standardName, undefined);
  assert.equal(cfFor("mrt_calculated_mrt").mapped, true);
  assert.equal(cfFor("mystery").mapped, false);
  assert.equal(ncName("9lives"), "v_9lives");
  assert.equal(ncName("a-b c"), "a_b_c");
});

test("the NetCDF writer round-trips attributes, numbers and strings", () => {
  const bytes = writeNetcdf3({
    dims: { n: 3, w: 6 },
    attrs: { title: "hello", count: { type: "int", value: 3 }, range: { type: "float", value: [1.5, 2.5] } },
    vars: [
      { name: "x", type: "double", dims: ["n"], attrs: { units: "m" }, data: [1.25, 2.5, -3] },
      { name: "f", type: "float", dims: ["n"], data: [0.5, 1, 2] },
      { name: "i", type: "int", dims: ["n"], data: [7, 8, 9] },
      { name: "s", type: "char", dims: ["n", "w"], data: ["one", "three", "é"] },
    ],
  });
  assert.deepEqual([...bytes.slice(0, 4)], [0x43, 0x44, 0x46, 1]);
  const f = parseNetcdf3(bytes);
  assert.equal(f.attrs.title, "hello");
  assert.equal(f.attrs.count, 3);
  assert.deepEqual(f.attrs.range, [1.5, 2.5]);
  assert.deepEqual(f.read("x"), [1.25, 2.5, -3]);
  assert.deepEqual(f.read("f"), [0.5, 1, 2]);
  assert.deepEqual(f.read("i"), [7, 8, 9]);
  assert.deepEqual(f.read("s"), ["one", "three", "é"]);
  assert.equal(f.vars.find((v) => v.name === "x")?.attrs.units, "m");
});

test("a release is CF-shaped: numeric time, coordinates, units, and a checksum file", async () => {
  const built = await buildRelease({
    period: OCT,
    dataset,
    stations: [
      { info: station("roof-a"), rows: rows(50) },
      { info: station("yard-b", { latitude: 39.5, longitude: -104.8, elevation: null }), rows: rows(20, 600, { pm25_ugm3: 8 }) },
    ],
    now: new Date("2026-11-02T00:00:00Z"),
  });
  assert.equal(built.ok, true, JSON.stringify(built.issues.filter((i) => i.severity === "error")));
  assert.deepEqual(built.files.map((f) => f.name), [
    "openiotwx-network_2026-10.nc",
    "openiotwx-network_2026-10.csv",
    "openiotwx-network_2026-10_metadata.json",
    "SHA256SUMS",
  ]);
  assert.equal(built.rows, 70);
  const nc = parseNetcdf3(built.files[0].data);
  assert.equal(nc.attrs.Conventions, "CF-1.8, ACDD-1.3");
  assert.equal(nc.attrs.featureType, "timeSeries");
  assert.equal(nc.dims.station, 2);
  assert.equal(nc.dims.obs, 70);
  assert.deepEqual(nc.read("row_size"), [50, 20]);
  assert.deepEqual(nc.read("station_id"), ["roof-a", "yard-b"]);
  // coordinates are rounded to 3 decimals, and every variable carries units and a long_name
  assert.deepEqual(nc.read("lat"), [40.015, 39.5]);
  assert.deepEqual(nc.read("lon"), [-105.271, -104.8]);
  for (const name of ["temp_c", "humidity_pct", "pm25_ugm3"]) {
    const v = nc.vars.find((x) => x.name === name)!;
    assert.equal(typeof v.attrs.units, "string", name);
    assert.equal(typeof v.attrs.long_name, "string", name);
    assert.equal(v.attrs.coordinates, "time lat lon alt");
  }
  assert.equal(nc.vars.find((v) => v.name === "temp_c")?.attrs.standard_name, "air_temperature");
  // time is a number in seconds since the epoch, not a string
  const time = nc.read("time") as number[];
  assert.equal(time[0], t0 + 3600);
  assert.equal(nc.vars.find((v) => v.name === "time")?.attrs.units, "seconds since 1970-01-01 00:00:00");
  // pm25 exists only for the second station; the first station's rows hold the fill value
  const pm = nc.read("pm25_ugm3") as number[];
  assert.ok(pm.slice(0, 50).every((v) => v > 1e36));
  assert.ok(pm.slice(50).every((v) => Math.abs(v - 8) < 1e-6));
  // a missing elevation is a warning, not an error
  assert.ok(built.issues.some((i) => i.code === "station.elevation" && i.severity === "warning"));
  // CSV: numeric time, coordinates on every row
  const csv = new TextDecoder().decode(built.files[1].data).split("\n");
  const header = csv.find((l) => !l.startsWith("#") && l.length)!;
  assert.match(header, /^station_id,latitude,longitude,altitude_m,time_utc_s,/);
  const first = csv.find((l) => l.startsWith("roof-a"))!.split(",");
  assert.equal(first[1], "40.015");
  assert.equal(first[4], String(t0 + 3600));
  // checksums match the files
  const sums = new TextDecoder().decode(built.files[3].data).trim().split("\n");
  for (const line of sums) {
    const [hash, name] = line.split("  ");
    assert.equal(built.files.find((f) => f.name === name)?.sha256, hash);
  }
  // the metadata record has the submission fields
  const meta = JSON.parse(new TextDecoder().decode(built.files[2].data));
  assert.equal(meta.release.stations, 2);
  assert.equal(meta.gdex_submission.update_frequency, "monthly releases");
  assert.ok(meta.variables.some((v: { standardName: string | null }) => v.standardName === "mass_concentration_of_pm2p5_ambient_aerosol_particles_in_air"));
});

test("the same input gives byte-identical files (so a checksum means something)", async () => {
  const args = { period: OCT, dataset, stations: [{ info: station("a"), rows: rows(30) }], now: new Date("2026-11-02T00:00:00Z") };
  const a = await buildRelease(args);
  const b = await buildRelease(args);
  assert.deepEqual(a.files.map((f) => f.sha256), b.files.map((f) => f.sha256));
});

test("what blocks a release: no stations, no coordinates, no description, no readings", async () => {
  const none = await buildRelease({ period: OCT, dataset, stations: [] });
  assert.equal(none.ok, false);
  assert.ok(none.issues.some((i) => i.code === "stations.none"));

  const noCoords = await buildRelease({ period: OCT, dataset, stations: [{ info: station("a", { latitude: null }), rows: rows(20) }] });
  assert.equal(noCoords.ok, false);
  assert.ok(noCoords.issues.some((i) => i.code === "station.location"));
  assert.equal(noCoords.files.length, 0);

  const undescribed = await buildRelease({ period: OCT, dataset: { ...dataset, summary: "" }, stations: [{ info: station("a"), rows: rows(20) }] });
  assert.equal(undescribed.ok, false);
  assert.ok(undescribed.issues.some((i) => i.code === "dataset.metadata"));

  const empty = await buildRelease({ period: OCT, dataset, stations: [{ info: station("a"), rows: [] }] });
  assert.equal(empty.ok, false);
  assert.ok(empty.issues.some((i) => i.code === "rows.none"));
});

test("data problems are reported, and data is never silently changed", async () => {
  const messy: Observation[] = [
    ...rows(12),
    { t: t0 + 3600, values: { temp_c: 99 } }, // same instant as the first row, and implausible
    { t: t0 - 5000, values: { temp_c: 1 } }, // before the period
    { t: OCT.end.getTime() / 1000 + 5, values: { temp_c: 1 } }, // after the period
    { t: t0 + 90000, values: { temp_c: Number.NaN } }, // not a number
    { t: t0 + 90001, values: { temp_c: 12, mystery_sensor: 3 } },
  ];
  const built = await buildRelease({ period: OCT, dataset, stations: [{ info: station("a"), rows: messy }] });
  const codes = built.issues.map((i) => i.code);
  assert.ok(codes.includes("rows.duplicate"));
  assert.ok(codes.includes("rows.outside"));
  assert.ok(codes.includes("values.nonfinite"));
  assert.ok(codes.includes("values.implausible"));
  assert.ok(codes.includes("variable.unmapped"));
  assert.equal(built.rows, 13);
  assert.equal(built.ok, true);
  const nc = parseNetcdf3(built.files[0].data);
  assert.equal(nc.vars.find((v) => v.name === "mystery_sensor")?.attrs.units, "1");
});

test("stations with no readings in the period are left out, not failed", async () => {
  const built = await buildRelease({ period: OCT, dataset, stations: [{ info: station("busy"), rows: rows(30) }, { info: station("quiet"), rows: [] }] });
  assert.equal(built.ok, true);
  assert.deepEqual(built.stations.map((s) => s.id), ["busy"]);
  assert.ok(built.issues.some((i) => i.code === "station.empty" && i.station === "quiet"));
});

test("a description check needs no readings", () => {
  const issues = checkDescription({ ...dataset, contactEmail: "", keywords: [] }, [station("a")]);
  assert.ok(issues.some((i) => i.severity === "error" && i.code === "dataset.metadata"));
  assert.ok(issues.some((i) => i.code === "dataset.keywords"));
});
