import { useEffect, useState } from "react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { Notice, btnGhost, btnPrimary } from "@/components/platform-ui";
import {
  gdexAdminBuild,
  gdexAdminDelete,
  gdexAdminOverview,
  gdexAdminPreview,
  gdexAdminSaveSettings,
  gdexAdminStatus,
} from "@/lib/gdex/api";
import { useAsync } from "@/lib/platform/hooks";
import { cn } from "@/lib/utils";

type Overview = Awaited<ReturnType<typeof gdexAdminOverview>>;
type Release = Overview["releases"][number];
type Preview = Awaited<ReturnType<typeof gdexAdminPreview>>;
type Issue = Preview["issues"][number];

const nf = new Intl.NumberFormat();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const input = "min-h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm";

const STATUS: Record<Release["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border border-line text-muted" },
  ready: { label: "Ready for GDEX", cls: "bg-moss text-kelp-deep" },
  submitted: { label: "Submitted to GDEX", cls: "bg-kelp text-paper" },
  published: { label: "Published", cls: "bg-kelp text-paper" },
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-2xl tabular-nums">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="text-sm text-muted">No issues found.</p>;
  const order = { error: 0, warning: 1, info: 2 } as const;
  return (
    <ul className="grid gap-1.5 text-sm">
      {[...issues]
        .sort((a, b) => order[a.severity] - order[b.severity])
        .map((i, k) => (
          <li key={k} className="flex items-start gap-2">
            <span
              className={cn(
                "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs",
                i.severity === "error" ? "bg-copper text-paper" : i.severity === "warning" ? "border border-copper text-copper" : "border border-line text-muted",
              )}
            >
              {i.severity}
            </span>
            <span>{i.message}</span>
          </li>
        ))}
    </ul>
  );
}

export function GdexAdmin() {
  const ov = useAsync(() => gdexAdminOverview(), [], 30000);
  const d = ov.data;
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lastBuild, setLastBuild] = useState<{ ok: boolean; issues: Issue[] } | null>(null);

  useEffect(() => {
    if (d && !period) setPeriod(d.periods[0]?.id ?? "");
  }, [d, period]);

  async function run<T>(fn: () => Promise<T>, done?: (r: T) => string) {
    setBusy(true);
    try {
      const r = await fn();
      if (done) toast.success(done(r));
      await ov.reload();
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <div>{ov.error ? <Notice>{ov.error}</Notice> : <p className="text-muted">Loading…</p>}</div>;

  return (
    <div className="grid gap-8">
      <section>
        <dl className="grid gap-3 sm:grid-cols-4">
          <Stat label="In the NCAR network" value={nf.format(d.counts.network)} hint="your own stations" />
          <Stat label="With GDEX consent" value={nf.format(d.counts.consented)} />
          <Stat label="Eligible for a release" value={nf.format(d.counts.eligible)} hint="network + consent + steward" />
          <Stat label="Releases" value={nf.format(d.releases.length)} hint={d.settings.cadence === "monthly" ? "monthly cadence" : "quarterly cadence"} />
        </dl>
        <p className="mt-3 max-w-3xl text-sm text-muted">
          A release packages every eligible station&apos;s readings for one finished {d.settings.cadence === "monthly" ? "month" : "quarter"} as CF-compliant NetCDF, a CSV copy and a
          metadata record. Build a draft, read the quality report, mark it ready, and GDEX can pull it from the{" "}
          <a className="text-kelp underline underline-offset-4" href="/gdex/manifest.json" target="_blank" rel="noreferrer">
            manifest
          </a>
          . You record the GDEX submission reference and the DOI they assign.
        </p>
      </section>

      <section aria-labelledby="gdex-build">
        <h2 id="gdex-build" className="font-display text-2xl">
          Build a release
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            Period
            <select value={period} onChange={(e) => { setPeriod(e.target.value); setPreview(null); setLastBuild(null); }} className={`${input} min-w-48`}>
              {d.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.built ? " (built)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            className={btnGhost}
            disabled={busy || !period}
            onClick={async () => {
              const r = await run(() => gdexAdminPreview({ data: { period } }));
              if (r) setPreview(r);
            }}
          >
            Check first
          </button>
          <button
            className={btnPrimary}
            disabled={busy || !period}
            onClick={async () => {
              const r = await run(() => gdexAdminBuild({ data: { period } }), (x) => (x.ok ? `Draft built: ${plural(x.stations, "station")}, ${nf.format(x.rows)} observations` : "Not built. See the report below"));
              if (r) setLastBuild({ ok: r.ok, issues: r.issues });
            }}
          >
            Build draft
          </button>
        </div>

        {preview ? (
          <div className="mt-4 rounded-2xl border border-line bg-card p-4">
            <p className="font-medium">
              Check for {preview.period.label}:{" "}
              {preview.ok ? <span className="text-kelp-deep">nothing blocks a release</span> : <span className="text-copper">blocked</span>}
            </p>
            <p className="mt-1 text-sm text-muted">
              {plural(preview.stations.length, "station")}, {nf.format(preview.rows)} observations, {plural(preview.variables.length, "variable")}
              {preview.files.length ? `, ${preview.files.map((f) => `${f.name.split(".").pop()} ${bytes(f.size)}`).join(", ")}` : ""}.
            </p>
            <div className="mt-3">
              <IssueList issues={preview.issues} />
            </div>
            {preview.variables.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-normal">Variable</th>
                      <th className="py-1 pr-3 font-normal">CF standard name</th>
                      <th className="py-1 pr-3 font-normal">Units</th>
                      <th className="py-1 pr-3 text-right font-normal">Values</th>
                      <th className="py-1 text-right font-normal">Stations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.variables.map((v) => (
                      <tr key={v.name} className="border-t border-line">
                        <td className="py-1 pr-3 font-mono">{v.name}</td>
                        <td className="py-1 pr-3 font-mono text-xs">{v.standardName ?? "—"}</td>
                        <td className="py-1 pr-3 font-mono text-xs">{v.units}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{nf.format(v.count)}</td>
                        <td className="py-1 text-right tabular-nums">{v.stationCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
        {lastBuild && !lastBuild.ok ? (
          <div className="mt-4 rounded-2xl border border-copper bg-card p-4">
            <p className="font-medium text-copper">The release was not built</p>
            <div className="mt-2">
              <IssueList issues={lastBuild.issues} />
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="gdex-releases">
        <h2 id="gdex-releases" className="font-display text-2xl">
          Releases
        </h2>
        {d.releases.length === 0 ? <p className="mt-2 text-sm text-muted">None yet. Build the first draft above.</p> : null}
        <ul className="mt-3 grid gap-4">
          {d.releases.map((r) => (
            <ReleaseCard key={r.id} r={r} busy={busy} run={run} />
          ))}
        </ul>
      </section>

      <Settings key={JSON.stringify(d.settings)} d={d} busy={busy} run={run} />

      <section aria-labelledby="gdex-stations">
        <h2 id="gdex-stations" className="font-display text-2xl">
          Stations that gave consent
        </h2>
        {d.stations.length === 0 ? <p className="mt-2 text-sm text-muted">No station has given consent yet. Stewards do that on their station page.</p> : null}
        {d.stations.length ? (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-3 py-2 font-normal">Station</th>
                  <th className="px-3 py-2 font-normal">Steward</th>
                  <th className="px-3 py-2 font-normal">License</th>
                  <th className="px-3 py-2 font-normal">Consent</th>
                  <th className="px-3 py-2 font-normal">Included</th>
                </tr>
              </thead>
              <tbody>
                {d.stations.map((s) => (
                  <tr key={s.slug} className="border-t border-line">
                    <td className="px-3 py-2">
                      <a className="text-kelp underline underline-offset-4" href={`/stations/${s.slug}`}>
                        {s.name}
                      </a>
                    </td>
                    <td className="px-3 py-2">{s.gdex_steward}</td>
                    <td className="px-3 py-2">{s.gdex_license}</td>
                    <td className="px-3 py-2">{s.gdex_consent_at ? new Date(s.gdex_consent_at).toLocaleDateString() : "—"}</td>
                    <td className="px-3 py-2">{s.ncar_network && s.latitude !== null ? "Yes" : <span className="text-copper">No: {s.ncar_network ? "no location" : "not in the network"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <p className="text-sm text-muted">
        Starting a new submission with GDEX:{" "}
        <a className="text-kelp underline underline-offset-4" href={d.submitUrl} target="_blank" rel="noreferrer">
          gdex.ucar.edu/resources/submit-data
        </a>
        . The dataset description in the words that form asks for is at{" "}
        <a className="text-kelp underline underline-offset-4" href="/gdex/dataset.json" target="_blank" rel="noreferrer">
          /gdex/dataset.json
        </a>
        .
      </p>
    </div>
  );
}

function ReleaseCard({ r, busy, run }: { r: Release; busy: boolean; run: <T>(fn: () => Promise<T>, done?: (r: T) => string) => Promise<T | null> }) {
  const [ref, setRef] = useState(r.submission_ref);
  const [doi, setDoi] = useState(r.doi);
  const [notes, setNotes] = useState(r.notes);
  const set = (status: Release["status"], msg: string) =>
    run(() => gdexAdminStatus({ data: { period: r.period, status, submissionRef: ref, doi, notes } }), () => msg);
  const s = STATUS[r.status];
  return (
    <li className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-xl">{r.period}</h3>
          <p className="text-sm text-muted">
            {plural(r.station_count, "station")}, {nf.format(r.observation_count)} observations
            {r.first_time ? `, ${new Date(r.first_time).toLocaleDateString()} to ${new Date(r.last_time ?? r.first_time).toLocaleDateString()}` : ""}
          </p>
        </div>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs", s.cls)}>{s.label}</span>
      </div>
      <p className="mt-2 text-sm">
        Quality report:{" "}
        <span className={r.error_count ? "text-copper" : "text-kelp-deep"}>{r.error_count} errors</span>, {r.warning_count} warnings
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted transition-colors duration-150 hover:text-ink">Report details</summary>
        <div className="mt-2">
          <IssueList issues={r.issues} />
        </div>
      </details>
      <ul className="mt-3 grid gap-1 text-sm">
        {r.files.map((f) => (
          <li key={f.name} className="flex flex-wrap items-baseline gap-x-3">
            <a className="text-kelp underline underline-offset-4" href={`/gdex/releases/${r.period}/${encodeURIComponent(f.name)}`}>
              {f.name}
            </a>
            <span className="text-muted">{bytes(f.size)}</span>
            <code className="text-xs text-muted">sha256 {f.sha256.slice(0, 12)}…</code>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          GDEX submission reference
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="The ID or ticket GDEX gave this submission" className={input} disabled={r.status === "published"} />
        </label>
        <label className="grid gap-1 text-sm">
          DOI (assigned by GDEX when it publishes)
          <input value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.5065/…" className={input} />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything GDEX asked for" className={input} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === "draft" ? (
          <>
            <button className={btnPrimary} disabled={busy || r.error_count > 0} onClick={() => void set("ready", "Marked ready. GDEX can now pull it")}>
              Mark ready for GDEX
            </button>
            <button
              className={btnGhost}
              disabled={busy}
              onClick={async () => {
                if (await confirmDialog({ title: "Delete this draft?", message: `The draft for ${r.period} is deleted. You can build it again.`, confirmLabel: "Delete draft", danger: true })) {
                  void run(() => gdexAdminDelete({ data: { period: r.period } }), () => "Draft deleted");
                }
              }}
            >
              Delete draft
            </button>
          </>
        ) : null}
        {r.status === "ready" ? (
          <>
            <button className={btnPrimary} disabled={busy} onClick={() => void set("submitted", "Recorded as submitted to GDEX")}>
              Record as submitted to GDEX
            </button>
            <button className={btnGhost} disabled={busy} onClick={() => void set("draft", "Back to draft. It is no longer public")}>
              Back to draft
            </button>
          </>
        ) : null}
        {r.status === "submitted" ? (
          <button className={btnPrimary} disabled={busy} onClick={() => void set("published", "Recorded as published")}>
            Record as published (DOI)
          </button>
        ) : null}
        {r.status !== "draft" && r.status !== "ready" ? (
          <button className={btnGhost} disabled={busy} onClick={() => void set(r.status, "Saved")}>
            Save notes
          </button>
        ) : null}
        {r.doi ? (
          <a className={btnGhost} href={r.doi.startsWith("http") ? r.doi : `https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">
            Open DOI
          </a>
        ) : null}
      </div>
    </li>
  );
}

function Settings({ d, busy, run }: { d: Overview; busy: boolean; run: <T>(fn: () => Promise<T>, done?: (r: T) => string) => Promise<T | null> }) {
  const s = d.settings;
  const [f, setF] = useState({ ...s, keywords: s.keywords.join(", ") });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <section aria-labelledby="gdex-settings">
      <h2 id="gdex-settings" className="font-display text-2xl">
        Dataset description and cadence
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        GDEX does not accept data without descriptive metadata. These words go into every file and into the submission record. A release is blocked until the title, summary, institution, creator, contact and license are filled in.
      </p>
      <div className="mt-3 grid gap-3 rounded-2xl border border-line bg-card p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm sm:col-span-2">
          Title
          <input value={f.title} onChange={set("title")} className={input} />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          Summary (what the data are, in a few sentences)
          <textarea value={f.summary} onChange={set("summary")} rows={4} className={`${input} py-2`} />
        </label>
        <label className="grid gap-1 text-sm sm:col-span-2">
          Institution
          <input value={f.institution} onChange={set("institution")} className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Creator name
          <input value={f.creatorName} onChange={set("creatorName")} className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Creator email
          <input value={f.creatorEmail} onChange={set("creatorEmail")} className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Contact name (for GDEX)
          <input value={f.contactName} onChange={set("contactName")} className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Contact email (for GDEX)
          <input value={f.contactEmail} onChange={set("contactEmail")} className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Keywords (comma separated)
          <input value={f.keywords} onChange={set("keywords")} className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Default license
          <select value={f.license} onChange={set("license")} className={input}>
            {["CC BY 4.0", "CC0 1.0", "ODbL 1.0"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Release cadence
          <select value={f.cadence} onChange={set("cadence")} className={input}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Coordinate decimals (3 is about 110 m, 5 is about 1 m)
          <input type="number" min={2} max={6} value={f.coordinateDecimals} onChange={(e) => setF((x) => ({ ...x, coordinateDecimals: Number(e.target.value) }))} className={input} />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.autoDraft} onChange={(e) => setF((x) => ({ ...x, autoDraft: e.target.checked }))} className="size-4" />
          Build a draft automatically when a period ends (the scheduler does this; a person still has to mark it ready)
        </label>
        <div className="sm:col-span-2">
          <button
            className={btnPrimary}
            disabled={busy}
            onClick={() =>
              void run(
                () => gdexAdminSaveSettings({ data: { ...f, keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean), cadence: f.cadence } }),
                () => "Saved",
              )
            }
          >
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
