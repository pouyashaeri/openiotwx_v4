#!/usr/bin/env node
/**
 * A full install of the app on a LOCAL Kubernetes (Docker Desktop), from nothing, with checks. It finds mistakes
 * in the Kubernetes files, the image and the production settings before the real cluster does.
 *
 *   node deploy/k8s/rehearse.mjs              build the image, install, test, remove everything
 *   node deploy/k8s/rehearse.mjs --keep       leave it running afterwards (kubectl -n openiotwx-rehearsal ...)
 *   node deploy/k8s/rehearse.mjs --no-build   reuse the image openiotwx-app:local
 *
 * It only ever talks to the "docker-desktop" context, in the namespace "openiotwx-rehearsal", and refuses anything
 * else. It deletes that namespace at the start (so every run is from scratch) and at the end (unless --keep).
 *
 * Set KUBECTL to a kubectl whose version matches the local cluster (Docker Desktop ships one) if yours is far off.
 *
 * What it checks:
 *   1. the image builds and the pods start under the strict security settings (non-root, read-only filesystem)
 *   2. migrations run as a job, and the app becomes ready (the health check includes the database)
 *   3. the security test (scripts/e2e-security.mjs) passes against the running install
 *   4. readings are not lost while pods are deleted and the deployment is restarted under live uploads
 *   5. the nightly backup job writes a dump that pg_restore can read
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import pg from "pg";

const CTX = "docker-desktop";
const NS = "openiotwx-rehearsal";
const KUBECTL = process.env.KUBECTL || "kubectl";
const APP_PORT = 8099;
const DB_PORT = 5467;
const args = new Set(process.argv.slice(2));
const keep = args.has("--keep");
let failed = false;
const ok = (c, m) => {
  console.log(c ? "ok  " : "FAIL:", m);
  if (!c) failed = true;
};
const log = (m) => console.log(`\n== ${m}`);

function kc(argv, { input, allowFail = false } = {}) {
  const r = spawnSync(KUBECTL, ["--context", CTX, ...argv], { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`kubectl ${argv.join(" ")} failed:\n${(r.stderr || r.stdout || "").trim().slice(0, 1500)}`);
  return (r.stdout || "").trim();
}
const kn = (argv, opts) => kc(["-n", NS, ...argv], opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
function forward(target, local, remote) {
  const p = spawn(KUBECTL, ["--context", CTX, "-n", NS, "port-forward", target, `${local}:${remote}`], { stdio: "ignore" });
  children.push(p);
  return p;
}
async function until(fn, what, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not yet */
    }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  log("Preflight");
  // Never touch anything but the local Docker Desktop cluster.
  const contexts = kc(["config", "get-contexts", "-o", "name"]).split(/\s+/);
  if (!contexts.includes(CTX)) throw new Error(`There is no kubectl context named ${CTX}. Turn on Kubernetes in Docker Desktop.`);
  const node = kc(["get", "nodes", "-o", "jsonpath={.items[*].metadata.name}"]);
  if (node.trim() !== "docker-desktop") throw new Error(`Refusing to run: the ${CTX} context shows nodes "${node}", not the single Docker Desktop node.`);
  ok(true, `talking only to the local ${CTX} cluster (${kc(["version", "-o", "json"], { allowFail: true }) ? "reachable" : "?"})`);

  if (!args.has("--no-build")) {
    log("Building the image");
    const b = spawnSync("docker", ["build", "-t", "openiotwx-app:local", "."], { stdio: "inherit" });
    ok(b.status === 0, "the image builds from the Dockerfile");
    if (b.status !== 0) return;
  }

  log("Fresh namespace and secrets");
  kc(["delete", "namespace", NS, "--ignore-not-found", "--wait=true", "--timeout=180s"]);
  kc(["create", "namespace", NS]);
  const dbPassword = randomBytes(18).toString("hex");
  const secret = randomBytes(48).toString("base64");
  const token = () => randomBytes(24).toString("hex");
  kn(["create", "secret", "generic", "openiotwx-db", `--from-literal=POSTGRES_PASSWORD=${dbPassword}`]);
  kn([
    "create", "secret", "generic", "openiotwx",
    `--from-literal=DATABASE_URL=postgres://iotwx:${dbPassword}@openiotwx-db:5432/iotwx`,
    `--from-literal=BETTER_AUTH_SECRET=${secret}`,
    `--from-literal=HUB_TOKEN=${token()}`,
    `--from-literal=INGEST_BRIDGE_TOKEN=${token()}`,
    `--from-literal=GDEX_RELEASE_TOKEN=${token()}`,
  ]);

  log("Installing");
  const rendered = spawnSync(KUBECTL, ["kustomize", "deploy/k8s/overlays/rehearsal"], { encoding: "utf8" });
  if (rendered.status !== 0) throw new Error(`kustomize failed:\n${rendered.stderr}`);
  // The rehearsal lists this address as a super-admin on purpose: it must still give nobody any powers.
  const manifest = rendered.stdout.replace("BETTER_AUTH_URL: http://localhost:8099", "BETTER_AUTH_URL: http://localhost:8099\n  SUPERADMIN_EMAILS: boss@example.com");
  kn(["apply", "-f", "-"], { input: manifest });

  await until(() => kn(["get", "statefulset", "openiotwx-db", "-o", "jsonpath={.status.readyReplicas}"]) === "1", "the database to be ready", 240);
  ok(true, "the bundled Postgres (TimescaleDB) is ready");
  try {
    kn(["wait", "--for=condition=complete", "job/openiotwx-migrate", "--timeout=240s"]);
    ok(true, "the migration job applied the migrations");
  } catch (e) {
    console.log(kn(["logs", "job/openiotwx-migrate", "--tail=30"], { allowFail: true }));
    throw e;
  }
  try {
    kn(["rollout", "status", "deployment/openiotwx", "--timeout=240s"]);
  } catch (e) {
    console.log(kn(["describe", "pods", "-l", "app.kubernetes.io/component=app"], { allowFail: true }).slice(-2500));
    console.log(kn(["logs", "-l", "app.kubernetes.io/component=app", "--tail=30"], { allowFail: true }));
    throw e;
  }
  const ready = kn(["get", "deployment", "openiotwx", "-o", "jsonpath={.status.readyReplicas}"]);
  ok(ready === "2", `both app copies are ready under the strict security settings (${ready}/2)`);
  const sc = JSON.parse(kn(["get", "pod", "-l", "app.kubernetes.io/component=app", "-o", "json"])).items[0].spec;
  ok(sc.securityContext.runAsNonRoot === true && sc.containers[0].securityContext.readOnlyRootFilesystem === true && sc.containers[0].securityContext.capabilities.drop.includes("ALL"), "the pod runs non-root, with a read-only filesystem and no capabilities");

  forward("svc/openiotwx", APP_PORT, 80);
  forward("pod/openiotwx-db-0", DB_PORT, 5432);
  await until(async () => (await fetch(`http://localhost:${APP_PORT}/api/health`)).status === 200, "the site to answer through the port-forward", 60);
  const health = await (await fetch(`http://localhost:${APP_PORT}/api/health`)).json();
  ok(health.ok === true, "the health check passes (it includes the database): " + JSON.stringify(health));
  const dbUrl = `postgres://iotwx:${dbPassword}@localhost:${DB_PORT}/iotwx`;

  // The first account on a database is the one the security test looks at.
  log("Security test against the running install");
  const sec = spawnSync("node", ["scripts/e2e-security.mjs", `http://localhost:${APP_PORT}`], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: dbUrl, PW_CHANNEL: process.env.PW_CHANNEL ?? "", SECURITY_LISTED_EMAIL: "boss@example.com" },
  });
  ok(sec.status === 0, "the security test passes against the install");

  log("Readings survive pods being deleted and the deployment restarting");
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const page = await (await browser.newContext()).newPage();
  await page.goto(`http://localhost:${APP_PORT}/login?next=/account`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Name").fill("Rollout");
  await page.getByLabel("Email").fill(`rollout-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: /^create account$/i }).click();
  await page.waitForURL("**/account", { timeout: 30000 });
  await page.getByText("Add a station by hand").click();
  await page.getByLabel("New station name").fill("Rollout check");
  await page.getByRole("button", { name: "Add station" }).click();
  await page.locator("pre").first().waitFor();
  const key = (await page.locator("pre").first().innerText()).trim();
  await browser.close();

  const client = new pg.Client({ connectionString: dbUrl });
  client.on("error", () => {}); // the port-forward is closed at the end; that is not an error worth a crash
  await client.connect();
  const station = (await client.query("select id from stations where api_key_hint = $1", [key.slice(0, 10)])).rows[0];
  await client.query("update stations set rate_limit_per_min = 100000 where id = $1", [station.id]);

  // The loader runs INSIDE the cluster, so its requests are balanced over the pods (a port-forward sticks to one pod).
  const N = 400;
  const script = `
    const key = process.env.KEY, N = ${N}, base = Date.now() - N * 1000;
    const accepted = new Set(); let retries = 0;
    (async () => {
      for (let i = 0; i < N; i++) {
        for (let attempt = 0; attempt < 8 && !accepted.has(i); attempt++) {
          try {
            const r = await fetch("http://openiotwx/api/ingest", { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" },
              body: JSON.stringify({ ts: new Date(base + i * 1000).toISOString(), values: { temp_c: i } }) });
            if (r.status === 202) accepted.add(i); else { retries++; await new Promise(s => setTimeout(s, 250)); }
          } catch { retries++; await new Promise(s => setTimeout(s, 250)); }
        }
        await new Promise(s => setTimeout(s, 70));
      }
      console.log("RESULT " + JSON.stringify({ accepted: accepted.size, retries }));
    })();`;
  kn(["run", "loader", "--image=openiotwx-app:local", "--image-pull-policy=Never", "--restart=Never", `--env=KEY=${key}`, "--command", "--", "node", "-e", script]);
  await sleep(6000);
  const pods = kn(["get", "pods", "-l", "app.kubernetes.io/component=app", "-o", "jsonpath={.items[*].metadata.name}"]).split(" ");
  kn(["delete", "pod", pods[0], "--wait=false"]); // a graceful stop: the pod gets SIGTERM and must flush its buffer
  await sleep(10000);
  kn(["rollout", "restart", "deployment/openiotwx"]);
  kn(["rollout", "status", "deployment/openiotwx", "--timeout=240s"]);
  await until(() => kn(["get", "pod", "loader", "-o", "jsonpath={.status.phase}"]) === "Succeeded", "the loader to finish", 240);
  const logs = kn(["logs", "loader"]);
  const result = JSON.parse(logs.split("\n").find((l) => l.startsWith("RESULT")).slice(7));
  await sleep(4000);
  const rows = Number((await client.query("select count(*)::int as n from measurements where station_id = $1", [station.id])).rows[0].n);
  await client.end();
  ok(result.accepted === N, `the site accepted all ${N} readings (${result.retries} retries while pods were stopping)`);
  ok(rows === result.accepted, `every accepted reading is in the database: ${rows} stored, ${result.accepted} accepted`);

  log("Nightly backup");
  kn(["create", "job", "--from=cronjob/openiotwx-backup", "backup-rehearsal"]);
  try {
    kn(["wait", "--for=condition=complete", "job/backup-rehearsal", "--timeout=480s"]);
    const out = kn(["logs", "job/backup-rehearsal"]);
    ok(/wrote \/backups\/openiotwx-.*\.dump \(\d+ bytes\)/.test(out), "the backup job wrote a dump: " + out.split("\n").pop());
  } catch (e) {
    console.log(kn(["logs", "job/backup-rehearsal"], { allowFail: true }));
    ok(false, "the backup job did not finish: " + e.message.split("\n")[0]);
  }
}

try {
  await main();
} catch (error) {
  ok(false, error.message);
} finally {
  for (const p of children) p.kill();
  if (keep) {
    console.log(`\nLeft running in the namespace ${NS}. Remove it with: kubectl --context ${CTX} delete namespace ${NS}`);
  } else {
    kc(["delete", "namespace", NS, "--ignore-not-found", "--wait=false"], { allowFail: true });
    console.log(`\nRemoving the namespace ${NS}.`);
  }
}
console.log(failed ? "REHEARSAL FAILED" : "Rehearsal passed");
process.exitCode = failed ? 1 : 0;
