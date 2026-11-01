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
