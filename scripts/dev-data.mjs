/**
 * Where the dev server keeps its embedded database.
 *
 * `npm run dev` uses PGLite (Postgres in WebAssembly) when no DATABASE_URL is set. In memory, a restart
 * wipes every account and station, which is painful when you are building a real station. So on the dev
 * server's normal port (8080) the data is kept on disk in `.data/pglite` and survives restarts.
 *
 *   PGLITE_DIR=some/folder   keep the data there (any port)
 *   PGLITE_DIR=memory        keep nothing: a fresh database on every start (what the tests use)
 *
 * Other ports stay in memory unless PGLITE_DIR says otherwise, so a second dev server (or a test server)
 * can never open the same folder as the first: PGLite files must belong to one process at a time.
 */
import { join, resolve } from "node:path";

export const PERSIST_PORT = 8080;

/** The folder to keep data in, or undefined to keep it in memory. */
export function devDataDir({ port, env, root }) {
  const value = String(env.PGLITE_DIR ?? "").trim();
  if (value === "memory" || value === ":memory:") return undefined;
  if (value) return resolve(root, value);
  return port === PERSIST_PORT ? join(root, ".data", "pglite") : undefined;
}
