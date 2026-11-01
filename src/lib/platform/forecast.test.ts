import assert from "node:assert/strict";
import { test } from "node:test";
import { forecastFromObservations, standInForecast } from "./forecast.ts";

const HOUR = 3600_000;
const start = Math.floor(Date.UTC(2026, 0, 1) / HOUR) * HOUR;
const day = (n: number, f: (h: number) => number) =>
  Array.from({ length: n }, (_, h) => ({ t: new Date(start + h * HOUR).toISOString(), avg: f(h) }));

test("too little history gives no forecast", () => {
  assert.deepEqual(standInForecast(day(2, () => 1)), []);
});

test("less than a day of history holds the latest value", () => {
  const f = standInForecast(day(6, (h) => h), 4);
  assert.equal(f.length, 4);
  assert.ok(f.every((p) => p.avg === 5));
});

test("with two days it repeats the daily cycle", () => {
  const cycle = (h: number) => 10 + 5 * Math.sin((2 * Math.PI * (h % 24)) / 24);
  const hist = day(48, cycle); // ends at hour 47
  const f = standInForecast(hist, 24);
  assert.equal(f.length, 24);
  // Exactly periodic history: the offset is zero, so the forecast equals the cycle.
  f.forEach((p, i) => assert.ok(Math.abs(p.avg - cycle(48 + i)) < 1e-9));
  assert.equal(new Date(f[0].t).getTime(), start + 48 * HOUR);
});

test("a station series maps to points, by our name or the model's", () => {
  const ours = [
    { t: 2000, values: { temp_c: 3 } },
    { t: 1000, values: { temp_c: 2 } },
  ];
  assert.deepEqual(forecastFromObservations(ours, "temp_c").map((p) => p.avg), [2, 3]);
  const model = [{ t: 1000, values: { temperature: 7, humidity: 40 } }];
  assert.deepEqual(forecastFromObservations(model, "temp_c").map((p) => p.avg), [7]);
  assert.deepEqual(forecastFromObservations(model, "humidity_pct").map((p) => p.avg), [40]);
});

test("a single unnamed value column is that variable; several are ambiguous", () => {
  assert.deepEqual(forecastFromObservations([{ t: 1, values: { x: 5 } }], "temp_c").map((p) => p.avg), [5]);
  assert.deepEqual(forecastFromObservations([{ t: 1, values: { x: 5, y: 6 } }], "temp_c"), []);
});

test("latitude and longitude columns are never mistaken for the variable", () => {
  const rows = [{ t: 1, values: { latitude: 40, longitude: -105, temperature: 12 } }];
  assert.deepEqual(forecastFromObservations(rows, "temp_c").map((p) => p.avg), [12]);
  assert.deepEqual(forecastFromObservations([{ t: 1, values: { latitude: 40, longitude: -105 } }], "temp_c"), []);
});

test("a gridded file uses the grid point nearest the station at each time", () => {
  const grid = (t: number, a: number, b: number) => [
    { t, values: { latitude: 40, longitude: 255, temperature: a } }, // 255°E is 105°W
    { t, values: { latitude: 38, longitude: 252, temperature: b } },
  ];
  const obs = [...grid(1000, 10, 99), ...grid(2000, 11, 98)];
  const here = { lat: 39.9, lon: -105.1 }; // nearest the first point
  assert.deepEqual(forecastFromObservations(obs, "temp_c", here).map((p) => p.avg), [10, 11]);
  const far = { lat: 37.5, lon: -108 }; // nearest the second
  assert.deepEqual(forecastFromObservations(obs, "temp_c", far).map((p) => p.avg), [99, 98]);
  // Without a station location there is no way to choose a point.
  assert.deepEqual(forecastFromObservations(obs, "temp_c"), []);
});
