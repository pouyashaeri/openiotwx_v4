import assert from "node:assert/strict";
import { test } from "node:test";
import { fromGateway } from "./gateway.ts";

test("gateway messages become namespaced metrics and skip housekeeping", () => {
  const { body, skipped, position } = fromGateway([
    { station_id: "s1", sensor: "bme680", measurement: "tmp", reading_value: "21.5", timestamp: 1_900_000_000 },
    { type: "keep_alive", station_id: "s1" },
    { sensor: "gbt_bme680", measurement: "Globe Temperature", reading_value: 31 },
    { sensor: "bme680", measurement: "hum", reading_value: "" },
  ]);
  assert.equal(skipped, 2);
  assert.equal(position, null);
  assert.deepEqual(body.readings.map((r) => r.values), [{ bme680_tmp: 21.5 }, { gbt_bme680_globe_temperature: 31 }]);
});

test("position messages move the station instead of becoming readings", () => {
  const a = fromGateway({ type: "station_info", latitude: 39.97, longitude: -105.27, altitude: 1624 });
  assert.deepEqual(a.position, { latitude: 39.97, longitude: -105.27, elevation: 1624 });
  assert.equal(a.body.readings.length, 0);
  const b = fromGateway([
    { sensor: "gps", measurement: "latitude", reading_value: "40.1" },
    { sensor: "gps", measurement: "longitude", reading_value: "999" },
  ]);
  assert.deepEqual(b.position, { latitude: 40.1 });
});

test("a weather sensor's pressure-derived altitude is a reading, not the station's elevation", () => {
  // The packet shapes a real RP2040 sends through the Pi gateway.
  const { body, position } = fromGateway([
    { type: "sensor_data", station_id: "DF6544F3CF2A1D35", sensor: "bme680", measurement: "altitude", reading_value: 318.0283, timestamp: "2026-11-02T12:53:03+00:00" },
    { type: "sensor_data", station_id: "DF6544F3CF2A1D35", sensor: "bme680", measurement: "pressure", reading_value: 975.63 },
    { type: "sensor_data", station_id: "DF6544F3CF2A1D35", sensor: "scd40", measurement: "CO2", reading_value: 684 },
    { type: "sensor_data", station_id: "DF6544F3CF2A1D35", sensor: "tmp117", measurement: "temperature", reading_value: 25.96875 },
  ]);
  assert.equal(position, null);
  assert.deepEqual(body.readings.map((r) => r.values), [{ bme680_altitude: 318.0283 }, { bme680_pressure: 975.63 }, { scd40_co2: 684 }, { tmp117_temperature: 25.96875 }]);
});

test("a GPS receiver's altitude is the station's elevation", () => {
  const { body, position } = fromGateway([
    { sensor: "pa1010d", measurement: "latitude", reading_value: 40.01 },
    { sensor: "pa1010d", measurement: "longitude", reading_value: -105.27 },
    { sensor: "pa1010d", measurement: "altitude", reading_value: 1655 },
  ]);
  assert.deepEqual(position, { latitude: 40.01, longitude: -105.27, elevation: 1655 });
  assert.equal(body.readings.length, 0);
});

test("a board with no location set (all zeros) does not move the station or wipe its elevation", () => {
  const blank = fromGateway({ type: "station_info", latitude: 0, longitude: 0, altitude: 0 });
  assert.equal(blank.position, null);
  const onlyElevation = fromGateway({ type: "station_info", latitude: 0, longitude: 0, altitude: 1650 });
  assert.deepEqual(onlyElevation.position, { elevation: 1650 });
  const placed = fromGateway({ type: "station_info", latitude: 33.42, longitude: -111.93, altitude: 0 });
  assert.deepEqual(placed.position, { latitude: 33.42, longitude: -111.93 });
});
