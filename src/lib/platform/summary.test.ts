import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize } from "./summary.ts";

const v = (n: number) => ({ v: n, t: "2026-01-01T00:00:00Z" });

test("summarizes platform metric names", () => {
  const s = summarize({ temp_c: v(22.4), humidity_pct: v(40), wind_ms: v(0.2), pm25_ugm3: v(4) });
  assert.deepEqual(s, ["It is mild at 22.4 °C with 40% humidity.", "The air is calm.", "Air quality looks good (PM2.5 4.0 µg/m³)."]);
});

test("understands the legacy gateway names and the MRT the device sends", () => {
  const s = summarize({ bme680_temperature: v(30), gbt_bme680_globe_temperature: v(38), mrt_calculated_mrt: v(41) });
  assert.match(s[0], /warm at 30\.0/);
  assert.match(s[1], /Mean radiant temperature is 41\.0 °C, higher/);
});

test("says nothing when there is nothing to say", () => {
  assert.deepEqual(summarize({}), []);
});
