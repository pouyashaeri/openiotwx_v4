import assert from "node:assert/strict";
import { test } from "node:test";
import { fromChordsQuery } from "./parse.ts";
import { fixUsPosition, parseChordsCsv, parseChordsData, parseChordsJson, shortnameOf, toGeoCsv } from "./chords-format.ts";

test("shortnames drop units and decoration", () => {
  assert.equal(shortnameOf("T1"), "t1");
  assert.equal(shortnameOf("Temperature (degC)"), "temperature");
  assert.equal(shortnameOf("rh1 [%]"), "rh1");
  assert.equal(shortnameOf("1bad"), null);
});

test("GeoCSV: comments skipped, blanks ignored, zoneless times are UTC", () => {
  const csv = ["# dataset: GeoCSV 2.0", "# delimiter: ,", "time,t1,rh1", "2026-01-01T00:00:00,20.5,40", "2026-01-01T00:01:00,20.6,", ""].join("\n");
  const obs = parseChordsCsv(csv);
  assert.equal(obs.length, 2);
  assert.equal(obs[0].t, Date.UTC(2026, 0, 1, 0, 0, 0));
  assert.deepEqual(obs[0].values, { t1: 20.5, rh1: 40 });
  assert.deepEqual(obs[1].values, { t1: 20.6 });
});

test("JSON: nested measurements, flat objects and GeoJSON features are all read", () => {
  const nested = JSON.stringify({ data: [{ time: "2026-01-01T00:00:00Z", measurements: { t1: 1, rh1: "2" } }] });
  const flat = JSON.stringify([{ at: "2026-01-01T00:00:00Z", t1: 3, note: "x" }]);
  const geo = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { time: "2026-01-01T00:00:00Z", t1: 4 } }] });
  assert.deepEqual(parseChordsJson(nested)[0].values, { t1: 1, rh1: 2 });
  assert.deepEqual(parseChordsJson(flat)[0].values, { t1: 3 });
  assert.deepEqual(parseChordsJson(geo)[0].values, { t1: 4 });
});

test("parseChordsData falls back to the other format", () => {
  assert.equal(parseChordsData("time,t1\n2026-01-01T00:00:00Z,1\n", "application/json").length, 1);
  assert.equal(parseChordsData('[{"time":"2026-01-01T00:00:00Z","t1":1}]', "text/csv").length, 1);
  assert.equal(parseChordsData("<html>nope</html>").length, 0);
});

test("GeoCSV output round-trips through the reader", () => {
  const rows = [
    { time: new Date("2026-01-01T00:00:00Z"), metric: "t1", value: 1.5 },
    { time: new Date("2026-01-01T00:00:00Z"), metric: "rh1", value: 40 },
    { time: new Date("2026-01-01T00:01:00Z"), metric: "t1", value: 1.6 },
  ];
  const csv = toGeoCsv({ name: "Test", latitude: 40, longitude: -105, units: { t1: "degC" } }, rows);
  assert.match(csv, /^# dataset: GeoCSV 2\.0/);
  const back = parseChordsCsv(csv);
  assert.equal(back.length, 2);
  assert.deepEqual(back[0].values, { rh1: 40, t1: 1.5 });
});

test("a CHORDS url_create query becomes an ingest body", () => {
  const q = new URLSearchParams("instrument_id=7&at=2026-01-01T00:00:00&T1=22.5&rh1=40&api_key=iotwx_x&email=a@b.c&test");
  const r = fromChordsQuery(q);
  assert.equal(r.instrumentId, 7);
  assert.equal(r.key, "iotwx_x");
  assert.equal(r.test, true);
  assert.equal(r.body.ts, "2026-01-01T00:00:00Z");
  assert.deepEqual(r.body.values, { t1: 22.5, rh1: 40 });
});

test("repairs or drops sloppy US portal coordinates", () => {
  assert.deepEqual(fixUsPosition("OU/Test", 35, 97), { lat: 35, lon: -97 });
  assert.equal(fixUsPosition("CO/thornton/ne", 39.9429, 39.9429), null);
  assert.deepEqual(fixUsPosition("CO/boulder/ncar", 40.01, -105.27), { lat: 40.01, lon: -105.27 });
  assert.deepEqual(fixUsPosition("Lagos", 6.5, 3.4), { lat: 6.5, lon: 3.4 });
  assert.deepEqual(fixUsPosition(null, 10, 120), { lat: 10, lon: 120 });
});
