import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ingestCommand, sampleValues, shellName } from "./sample.ts";

describe("the example reading", () => {
  it("has a believable value for each of the station's metrics, never zero", () => {
    const v = sampleValues(["temp_c", "humidity_pct", "co2_ppm", "my_own_metric"]);
    assert.deepEqual(v, { temp_c: 21.4, humidity_pct: 48, co2_ppm: 425, my_own_metric: 1 });
    assert.ok(Object.values(v).every((n) => n !== 0 || false));
  });

  it("is one curl command for a terminal", () => {
    const cmd = ingestCommand({ origin: "http://x:8080", key: "iotwx_k", values: { temp_c: 21.4 }, windows: false });
    assert.equal(cmd.split("curl").length - 1, 1);
    assert.ok(cmd.includes(`-d '{"values":{"temp_c":21.4}}'`));
    assert.ok(cmd.includes('-H "x-api-key: iotwx_k"'));
    assert.equal(shellName(false), "Terminal");
  });

  it("uses curl.exe and escaped quotes in PowerShell", () => {
    const cmd = ingestCommand({ origin: "http://x:8080", key: "iotwx_k", values: { temp_c: 21.4 }, windows: true });
    assert.ok(cmd.startsWith("curl.exe -X POST http://x:8080/api/ingest `"));
    assert.ok(cmd.includes(`-d '{\\"values\\":{\\"temp_c\\":21.4}}'`));
    assert.equal(shellName(true), "PowerShell");
  });
});
