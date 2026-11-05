#!/usr/bin/env node
/**
 * Renders the Kubernetes overlays and checks the things that must not quietly change: pods run as non-root with a
 * read-only filesystem and no capabilities, nothing uses a floating image tag, no Secret is rendered into git, and the
 * app's probes and shutdown settings are what the code relies on.
 *
 *   node scripts/check-manifests.mjs            (needs kubectl on the PATH, or set KUBECTL)
 *
 * It reads the rendered YAML as text (kustomize writes plain block style), so it needs no YAML library. Run in CI.
 */
import { spawnSync } from "node:child_process";

const KUBECTL = process.env.KUBECTL || "kubectl";
const OVERLAYS = ["deploy/k8s/overlays/rehearsal", "deploy/k8s/overlays/example"];
let failed = false;
const ok = (c, m) => {
  console.log(c ? "ok  " : "FAIL:", m);
  if (!c) failed = true;
};

function render(path) {
  const r = spawnSync(KUBECTL, ["kustomize", path], { encoding: "utf8" });
  if (r.status !== 0) {
    ok(false, `kustomize could not render ${path}: ${(r.stderr || "").trim().slice(0, 300)}`);
    return [];
  }
  return r.stdout.split(/^---$/m).map((d) => d.trim()).filter(Boolean);
}
const kindOf = (doc) => (doc.match(/^kind: (\w+)/m) ?? [])[1];
/** The metadata name: the first "  name:" line after "metadata:". */
function nameOf(doc) {
  const lines = doc.split("\n");
  const start = lines.indexOf("metadata:");
  for (let i = start + 1; i < lines.length && lines[i].startsWith(" "); i++) {
    const m = lines[i].match(/^  name: (\S+)/);
    if (m) return m[1];
  }
  return undefined;
}
/** The text under a key such as "livenessProbe:", up to the next line that is not indented deeper than the key. */
function block(doc, key) {
  const lines = doc.split("\n");
  const at = lines.findIndex((l) => l.trim() === key);
  if (at < 0) return "";
  const indent = lines[at].length - lines[at].trimStart().length;
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    const n = lines[i].length - lines[i].trimStart().length;
    if (lines[i].trim() && n <= indent) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}
const count = (doc, re) => (doc.match(re) ?? []).length;

for (const overlay of OVERLAYS) {
  const docs = render(overlay);
  const label = overlay.split("/").pop();
  ok(docs.length > 0, `${label}: renders`);
  if (!docs.length) continue;

  ok(!docs.some((d) => kindOf(d) === "Secret"), `${label}: no Secret is rendered (secrets are made outside git)`);

  // Images: always a pinned tag, never "latest" or missing.
  const images = docs.flatMap((d) => [...d.matchAll(/^\s+image: (\S+)/gm)].map((m) => m[1]));
  const floating = images.filter((i) => !/:[^/:]+$/.test(i) || /:latest$/.test(i));
  ok(images.length > 0 && floating.length === 0, `${label}: every image has a pinned tag (${[...new Set(images)].join(", ")})` + (floating.length ? ` - floating: ${floating.join(", ")}` : ""));

  // Nothing secret in the ConfigMap.
  const config = docs.find((d) => kindOf(d) === "ConfigMap" && /openiotwx-config/.test(nameOf(d) ?? ""));
  const leaked = (config?.match(/^  (\w*(?:SECRET|TOKEN|PASSWORD|API_KEY|_KEY|SMTP_URL)\w*): \S+/gm) ?? []).map((l) => l.trim());
  ok(Boolean(config) && leaked.length === 0, `${label}: the ConfigMap holds no secrets` + (leaked.length ? `: ${leaked.join(" | ")}` : ""));
  const url = (config?.match(/^  BETTER_AUTH_URL: (\S+)/m) ?? [])[1] ?? "";
  ok(/^https:\/\//.test(url) || /^http:\/\/localhost(:\d+)?$/.test(url), `${label}: BETTER_AUTH_URL is https (or localhost): ${url}`);
  ok(/^  CHORDS_ALLOW_PRIVATE: "?0"?$/m.test(config ?? ""), `${label}: CHORDS_ALLOW_PRIVATE stays off`);

  // Every pod: non-root, no API token, default seccomp, and every container locked down.
  const workloads = docs.filter((d) => ["Deployment", "Job", "CronJob", "StatefulSet"].includes(kindOf(d)));
  for (const w of workloads) {
    const id = `${label}: ${kindOf(w)}/${nameOf(w)}`;
    const containers = count(w, /^\s+- name: [\w-]+\n\s+image: /gm) || count(w, /^\s+image: /gm);
    const isDb = /component: db/.test(w) && kindOf(w) === "StatefulSet";
    ok(/automountServiceAccountToken: false/.test(w), `${id}: no service-account token is mounted`);
    ok(/runAsNonRoot: true/.test(w) && !/runAsUser: 0\b/.test(w), `${id}: runs as non-root`);
    ok(/type: RuntimeDefault/.test(w), `${id}: uses the default seccomp profile`);
    ok(count(w, /allowPrivilegeEscalation: false/g) >= containers, `${id}: no privilege escalation (${containers} container${containers === 1 ? "" : "s"})`);
    ok(count(w, /- ALL/g) >= containers, `${id}: all Linux capabilities dropped`);
    ok(count(w, /^\s+limits:/gm) >= containers, `${id}: has resource limits`);
    // The database needs to write to its own folders, so only it is exempt from a read-only filesystem.
    if (!isDb) ok(count(w, /readOnlyRootFilesystem: true/g) >= containers, `${id}: read-only root filesystem`);
  }

  // What the app's code relies on.
  const app = docs.find((d) => kindOf(d) === "Deployment" && nameOf(d) === "openiotwx");
  if (app) {
    const readiness = block(app, "readinessProbe:");
    const liveness = block(app, "livenessProbe:");
    ok(/path: \/api\/health/.test(readiness), `${label}: readiness uses /api/health (it includes the database)`);
    ok(/tcpSocket:/.test(liveness) && !/httpGet:/.test(liveness), `${label}: liveness is a TCP check, so a database outage does not restart every pod`);
    ok(/startupProbe:/.test(app), `${label}: has a startup probe`);
    ok(/terminationGracePeriodSeconds: (\d+)/.test(app) && Number(app.match(/terminationGracePeriodSeconds: (\d+)/)[1]) >= 30, `${label}: at least 30 s to flush readings on shutdown`);
    ok(/maxUnavailable: 0/.test(app), `${label}: a rolling update never takes a pod away before its replacement is ready`);
    ok(/name: DATABASE_URL\n\s+valueFrom:\n\s+secretKeyRef:/.test(app) && /name: BETTER_AUTH_SECRET\n\s+valueFrom:\n\s+secretKeyRef:/.test(app), `${label}: the database address and the session secret come from the Secret`);
  } else ok(false, `${label}: the app Deployment is there`);
  ok(docs.some((d) => kindOf(d) === "Job" && /argocd.argoproj.io\/hook: PreSync/.test(d)), `${label}: migrations run as a PreSync job`);
}

console.log(failed ? "MANIFEST CHECK FAILED" : "Manifest check passed");
process.exitCode = failed ? 1 : 0;
