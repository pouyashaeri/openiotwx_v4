import assert from "node:assert/strict";
import { test } from "node:test";
import { IngestError, MAX_READINGS, parseBody } from "./parse.ts";

const S = "station-1";

test("a single reading becomes one row per metric, stamped now", () => {
  const before = Date.now();
  const { rows, rejected } = parseBody({ values: { temp_c: 21.5, humidity_pct: 40 } }, S);
  assert.equal(rejected, 0);
  assert.deepEqual(rows.map((r) => r.metric).sort(), ["humidity_pct", "temp_c"]);
  assert.ok(rows.every((r) => r.station === S && r.t >= before));
});

test("batches keep each reading's own timestamp (ISO and milliseconds)", () => {
  const t1 = Date.now() - 120_000;
  const t2 = Date.now() - 60_000;
  const { rows } = parseBody(
    {
      readings: [
        { ts: new Date(t1).toISOString(), values: { a: 1 } },
        { ts: t2, values: { a: 2 } },
      ],
    },
    S,
  );
  assert.deepEqual(
    rows.map((r) => r.t),
    [new Date(new Date(t1).toISOString()).getTime(), t2],
  );
});

test("recent timestamps in seconds are read as seconds", () => {
  const sec = Math.floor(Date.now() / 1000) - 30;
  const { rows } = parseBody({ ts: sec, values: { a: 1 } }, S);
  assert.equal(rows[0].t, sec * 1000);
});

test("bad metric names, non-numbers and non-finite values are rejected, good ones kept", () => {
  const { rows, rejected } = parseBody(
    { values: { ok: 1, "Bad Name": 2, str: "3", inf: Infinity, huge: 1e12, nan: Number.NaN } },
    S,
  );
  assert.deepEqual(rows.map((r) => r.metric), ["ok"]);
  assert.equal(rejected, 5);
});

test("timestamps from the far future or distant past are rejected", () => {
  const now = Date.now();
  const { rows, rejected } = parseBody(
    {
      readings: [
        { ts: now + 3600_000, values: { a: 1 } },
        { ts: now - 400 * 86400_000, values: { a: 1 } },
        { ts: now - 1000, values: { a: 1 } },
      ],
    },
    S,
  );
  assert.equal(rows.length, 1);
  assert.equal(rejected, 2);
});

test("readings without values are counted as rejected", () => {
  const { rows, rejected } = parseBody({ readings: [{ ts: Date.now() }, { values: [1, 2] }, null] }, S);
  assert.equal(rows.length, 0);
  assert.equal(rejected, 3);
});

test("oversized requests fail with 413", () => {
  const readings = Array.from({ length: MAX_READINGS + 1 }, () => ({ values: { a: 1 } }));
  assert.throws(
    () => parseBody({ readings }, S),
    (e: unknown) => e instanceof IngestError && e.status === 413,
  );
});
