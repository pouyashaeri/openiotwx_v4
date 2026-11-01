import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { devDataDir } from "./dev-data.mjs";

const root = resolve("/work/app");

test("the normal dev port keeps its data on disk", () => {
  assert.equal(devDataDir({ port: 8080, env: {}, root }), join(root, ".data", "pglite"));
});

test("any other port stays in memory, so two servers never share a folder", () => {
  assert.equal(devDataDir({ port: 8090, env: {}, root }), undefined);
  assert.equal(devDataDir({ port: 8091, env: { PGLITE_DIR: "" }, root }), undefined);
});

test("PGLITE_DIR chooses the folder on any port, relative to the project", () => {
  assert.equal(devDataDir({ port: 8091, env: { PGLITE_DIR: "tmp/db" }, root }), resolve(root, "tmp/db"));
  assert.equal(devDataDir({ port: 8080, env: { PGLITE_DIR: "tmp/db" }, root }), resolve(root, "tmp/db"));
});

test("PGLITE_DIR=memory forces a fresh database, even on the normal port", () => {
  assert.equal(devDataDir({ port: 8080, env: { PGLITE_DIR: "memory" }, root }), undefined);
  assert.equal(devDataDir({ port: 8080, env: { PGLITE_DIR: ":memory:" }, root }), undefined);
});
