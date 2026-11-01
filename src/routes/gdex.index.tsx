import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CopyBlock } from "@/components/platform-ui";
import { gdexPublic } from "@/lib/gdex/api";
import { cfCatalog } from "@/lib/gdex/cf";
import { useAsync } from "@/lib/platform/hooks";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/gdex/")({
  head: () => ({ meta: [{ title: "Data and GDEX | OpenIoTwx" }] }),
  component: GdexPage,
});

const nf = new Intl.NumberFormat();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

const JOURNEY = [
  { title: "Plan", text: "The wizard picks the sensors, so the variables are known before anything is built.", to: "/wizard" as const },
  { title: "Build and flash", text: "A station is built and flashed in the browser with its own station key.", to: "/flash" as const },
  { title: "Deploy and join", text: "Put it up, register it, and choose to join the NCAR research network.", to: "/deploy" as const },
  { title: "Consent", text: "A named steward says yes to archiving. It can be withdrawn at any time.", to: "/account" as const },
  { title: "Release", text: "Each month or quarter the network's data is packaged for GDEX, reviewed, and given a DOI.", to: "/gdex" as const },
];

/** What GDEX asked for, and what a release does about it. */
const MEETS = [
  ["Time is a number, not a string", "A numeric UTC time: seconds since 1970-01-01 00:00:00 (CF time)."],
  ["Coordinates on every station", "Latitude, longitude and altitude for each station, rounded to about 110 m so a station is a neighbourhood, not a rooftop."],
  ["Descriptive metadata", "Title, summary, institution, creator, contact, license and keywords in the file, plus a long name and units on every variable."],
  ["CF compliance", "CF-1.8 with ACDD-1.3, laid out as a time series per station. Standard names are used where one fits, and never guessed where none does."],
  ["Formats, compression, chunking", "NetCDF and a CSV copy. A converter makes NetCDF-4 with compression and chunking for large archives."],
  ["A submission cadence", "One release per finished month or quarter, built as a draft, checked by a person, then pulled by GDEX."],
  ["Checkable", "Every file has a SHA-256 in a manifest, and a quality report says what was found."],
  ["Consent", "Only stations in the network, with a named steward's consent, are ever included."],
];

function GdexPage() {
  const q = useAsync(() => gdexPublic(), []);
  const d = q.data;
  // Same text on the server and on first paint; the real address appears right after.
  const [origin, setOrigin] = useState("https://your-site");
  useEffect(() => setOrigin(window.location.origin), []);
  const catalog = cfCatalog().filter((c) => c.match === "exact");

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-display text-4xl sm:text-5xl">From a station on a roof to the GDEX archive</h1>
      <p className="mt-3 max-w-3xl text-muted">
        GDEX is the NSF NCAR Geoscience Data Exchange: a long-term archive that gives research data a DOI. Stations built here can join the NCAR research network, and with
        their steward&apos;s consent their readings are released to GDEX in a form the archive can take as it is: numeric time, coordinates, units, descriptive metadata and CF
        conventions.
      </p>

      <section className="mt-8" aria-labelledby="journey">
        <h2 id="journey" className="font-display text-2xl">
          How a reading gets there
        </h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {JOURNEY.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line bg-card p-4">
              <p className="grid size-6 place-items-center rounded-full bg-moss text-xs text-kelp-deep">{i + 1}</p>
              <p className="mt-2 font-medium">{s.title}</p>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
              <Link to={s.to} className="mt-2 inline-block text-sm text-kelp underline underline-offset-4">
                Open
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="status">
        <h2 id="status" className="font-display text-2xl">
          Where the network is now
        </h2>
        {q.error ? <p className="mt-2 text-sm text-copper">{q.error}</p> : null}
        <dl className="mt-3 grid gap-3 sm:grid-cols-4">
          <Stat label="Stations in the network" value={d ? nf.format(d.counts.network) : "…"} />
          <Stat label="Included in releases" value={d ? nf.format(d.counts.eligible) : "…"} hint="in the network, with consent" />
          <Stat label="Releases" value={d ? nf.format(d.releases.length) : "…"} />
          <Stat label="Cadence" value={d ? (d.dataset.cadence === "monthly" ? "Monthly" : "Quarterly") : "…"} />
        </dl>

        <h3 className="mt-6 font-display text-xl">Releases</h3>
        {d && d.releases.length === 0 ? (
          <p className="mt-2 text-sm text-muted">The first release appears here once a period has ended, a draft has been checked and marked ready.</p>
        ) : null}
        <ul className="mt-3 grid gap-3">
          {d?.releases.map((r) => (
            <li key={r.period} className="rounded-2xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-xl">{r.period}</p>
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs", r.status === "ready" ? "bg-moss text-kelp-deep" : "bg-kelp text-paper")}>
                  {r.status === "ready" ? "Ready for GDEX" : r.status === "submitted" ? "Submitted to GDEX" : "Published"}
                </span>
              </div>
              <p className="text-sm text-muted">
                {plural(r.stations, "station")}, {nf.format(r.observations)} observations
                {r.doi ? (
                  <>
                    {" "}
                    ·{" "}
                    <a className="text-kelp underline underline-offset-4" href={r.doi.startsWith("http") ? r.doi : `https://doi.org/${r.doi}`}>
                      DOI {r.doi}
                    </a>
                  </>
                ) : null}
              </p>
              <ul className="mt-2 grid gap-1 text-sm">
                {r.files.map((f) => (
                  <li key={f.name} className="flex flex-wrap items-baseline gap-x-3">
                    <a className="text-kelp underline underline-offset-4" href={f.url}>
                      {f.name}
                    </a>
                    <span className="text-muted">{bytes(f.size)}</span>
                    <code className="text-xs text-muted">sha256 {f.sha256.slice(0, 12)}…</code>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10" aria-labelledby="meets">
        <h2 id="meets" className="font-display text-2xl">
          What GDEX asked for, and what a release does
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          GDEX&apos;s minimum is not to do anything bizarre: no dates as text, always coordinates, always descriptive metadata. They prefer full CF compliance.
        </p>
        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-card">
          <dl className="divide-y divide-line">
            {MEETS.map(([k, v]) => (
              <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[16rem_1fr]">
                <dt className="font-medium">{k}</dt>
                <dd className="text-sm text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="vars">
        <h2 id="vars" className="font-display text-2xl">
          How each measurement is described
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Every variable carries units and a long name. A CF standard name is added only where one really describes the measurement.
        </p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-3 py-2 font-normal">Name in a file</th>
                <th className="px-3 py-2 font-normal">Description</th>
                <th className="px-3 py-2 font-normal">CF standard name</th>
                <th className="px-3 py-2 font-normal">Units</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((c) => (
                <tr key={c.name} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs">{c.name}</td>
                  <td className="px-3 py-2">{c.longName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.standardName ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="machines">
        <h2 id="machines" className="font-display text-2xl">
          For GDEX and other machines
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Releases are pulled from a stable manifest. Each file has a size and a SHA-256, so a pull can be checked.
        </p>
        <div className="mt-3 grid min-w-0 gap-3 [&>*]:min-w-0">
          <CopyBlock label="Manifest of releases" text={`${origin}/gdex/manifest.json`} />
          <CopyBlock label="Dataset description (the words the submission form asks for)" text={`${origin}/gdex/dataset.json`} />
          <CopyBlock label="Fetch the latest manifest and check a file" text={`curl -s ${origin}/gdex/manifest.json\ncurl -sO ${origin}/gdex/releases/<period>/<file>\nsha256sum -c SHA256SUMS`} />
        </div>
      </section>

      <section className="mt-10 rounded-2xl border border-line bg-paper-deep p-5" aria-labelledby="join">
        <h2 id="join" className="font-display text-2xl">
          Make your station GDEX-ready
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Plan it in the wizard, build and flash it, and register it. On the station&apos;s page, join the NCAR research network, then give GDEX consent with a named steward. From
          then on its readings are included in each release, and you can withdraw for future ones at any time.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/wizard" className="inline-flex min-h-11 items-center rounded-full bg-kelp px-5 text-sm font-medium text-paper transition-[filter] duration-150 not-disabled:hover:brightness-110">
            Plan a station
          </Link>
          <Link to="/account" className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-5 text-sm font-medium transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep">
            My system
          </Link>
          {d ? (
            <a href={d.submitUrl} className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-5 text-sm font-medium transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep" target="_blank" rel="noreferrer">
              GDEX data submission
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-2xl tabular-nums">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
