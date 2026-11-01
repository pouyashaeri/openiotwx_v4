import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CopyBlock, Notice, RequireUser, StatusDot, btnGhost, btnPrimary } from "@/components/platform-ui";
import { FlowSteps } from "@/components/flow-steps";
import { editStation, listMyStations, newKey, stationView } from "@/lib/platform/api";
import { ago, useAsync } from "@/lib/platform/hooks";
import { metricInfo } from "@/lib/platform/metrics";
import { useDraft } from "@/lib/wizard/store";
import { confirmDialog } from "@/components/confirm-dialog";

export const Route = createFileRoute("/deploy")({
  head: () => ({ meta: [{ title: "Step 3: Deploy and Publish — OpenIoTwx" }] }),
  validateSearch: (q: Record<string, unknown>) => ({ station: typeof q.station === "string" ? q.station : undefined }),
  component: () => (
    <RequireUser>
      <Deploy />
    </RequireUser>
  ),
});

function Deploy() {
  const { station: wanted } = Route.useSearch();
  const mine = useAsync(() => listMyStations(), []);
  const slug = wanted ?? mine.data?.[0]?.slug;
  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <FlowSteps current={3} station={slug} />
      <h1 className="font-display text-4xl sm:text-5xl">Deploy and Publish</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Put the flashed station to work, check it is reporting, then choose who can see it.
      </p>
      {mine.error ? <div className="mt-4"><Notice>{mine.error}</Notice></div> : null}
      {mine.data && !mine.data.length ? (
        <p className="mt-6 rounded-2xl border border-line bg-card p-5 text-sm">
          You have no stations yet. Finish a plan and register its stations, or{" "}
          <Link to="/account" className="text-kelp underline underline-offset-4">
            add one by hand
          </Link>
          .
        </p>
      ) : null}
      {mine.data?.length ? (
        <>
          <label className="mt-6 block text-sm text-muted">
            Station
            <select
              value={slug}
              onChange={(e) => (window.location.href = `/deploy?station=${encodeURIComponent(e.target.value)}`)}
              className="mt-1 block min-h-11 w-full max-w-sm rounded-xl border border-line bg-card px-3 text-ink"
            >
              {mine.data.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {slug ? <Panels slug={slug} /> : null}
        </>
      ) : null}
    </main>
  );
}

function Panels({ slug }: { slug: string }) {
  const view = useAsync(() => stationView({ data: { slug, range: "24h" } }), [slug], 5000);
  const st = view.data?.station;
  if (!st) return <p className="mt-6 text-muted">{view.loading ? "Loading…" : "Station not found."}</p>;
  const reporting = Boolean(st.last_seen_at);
  return (
    <div className="mt-6 grid gap-8">
      <SetUp station={st} reporting={reporting} />
      <Publish station={st} onChanged={() => void view.reload()} />
      <div className="flex justify-end">
        <Link to="/track" search={{ station: st.slug }} className={btnPrimary}>
          Next: Track and Forecast
        </Link>
      </div>
    </div>
  );
}

type St = NonNullable<Awaited<ReturnType<typeof stationView>>>["station"];

function SetUp({ station, reporting }: { station: St; reporting: boolean }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const metrics = station.expected_metrics.length ? station.expected_metrics : ["temp_c"];
  const sample = Object.fromEntries(metrics.map((m) => [m, 0]));
  const k = key ?? "YOUR_STATION_KEY";
  const settings = JSON.stringify({ server: origin, key: k, interval_s: 60, metrics }, null, 2);
  const http = `curl -X POST ${origin}/api/ingest \\\n  -H "x-api-key: ${k}" -H "content-type: application/json" \\\n  -d '${JSON.stringify({ values: sample })}'`;
  const chords = `${origin}/measurements/url_create?instrument_id=${station.chords_id}&${metrics.map((m) => `${m}=0`).join("&")}&api_key=${k}`;
  const mqtt = `topic:   openiotwx/${station.slug}\npayload: ${JSON.stringify({ key: k, values: sample })}`;

  return (
    <section aria-labelledby="setup">
      <h2 id="setup" className="font-display text-2xl">
        1. Set the station up
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Give the flashed board this station's address and key. Pick whichever way your firmware sends data.
      </p>

      <div
        className={`mt-4 flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${reporting ? "border-emerald-500 bg-card" : "border-line bg-card"}`}
        role="status"
      >
        <StatusDot station={station} />
        <p className="text-sm">
          {reporting
            ? `Reporting. Last reading ${ago(station.last_seen_at)}, ${Object.keys(station.last_values).length} variables.`
            : "Waiting for the first reading. This checks every few seconds, so leave the page open and power the station on."}
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-card p-5">
        <p className="text-sm text-muted">
          The key is only shown when it is made. {key ? "Copy it into the station now." : "Make a new one to see ready-to-paste settings. The old key stops working."}
        </p>
        <button
          className={`${btnGhost} mt-3`}
          disabled={busy}
          onClick={async () => {
            if (!(await confirmDialog({ title: "Make a new key?", message: "The station stops uploading until you put the new key on it.", confirmLabel: "Make new key" }))) return;
            setBusy(true);
            try {
              setKey(await newKey({ data: { id: station.id } }));
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not make a key");
            } finally {
              setBusy(false);
            }
          }}
        >
          {key ? "Make another key" : "Make a key and show settings"}
        </button>
        <CopyBlock label="Station settings (config.json)" text={settings} />
        {key ? (
          <button
            type="button"
            className="mt-2 text-sm text-kelp underline underline-offset-4"
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([settings], { type: "application/json" }));
              a.download = "config.json";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Download config.json
          </button>
        ) : null}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">Other ways to send data</summary>
          <CopyBlock label="HTTP (any computer or board)" text={http} />
          <CopyBlock label="CHORDS-style address (devices already set up for CHORDS)" text={chords} />
          <CopyBlock label="MQTT (needs the optional MQTT service)" text={mqtt} />
        </details>
      </div>
    </section>
  );
}

function Publish({ station, onChanged }: { station: St; onChanged: () => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  // The same switch as the plan's data section: one decision, in one place.
  const gdex = useDraft((state) => state.answers.gdex);
  const patchAnswers = useDraft((state) => state.patchAnswers);
  const page = `${origin}/stations/${station.slug}`;
  const csv = `${origin}/instruments/${station.chords_id}.csv`;
  const request = [
    `Please add my station to the NCAR network.`,
    ``,
    `Station: ${station.name}`,
    `Public page: ${page}`,
    `Data (CHORDS format, GeoCSV): ${csv}`,
    `Data (JSON): ${origin}/api/v1/data/${station.chords_id}.json`,
    `Variables: ${station.expected_metrics.map((m) => metricInfo(m).label).join(", ") || "see the station page"}`,
    station.latitude != null && station.longitude != null ? `Location: ${station.latitude}, ${station.longitude}` : `Location: (add one on the station page)`,
  ].join("\n");

  return (
    <section aria-labelledby="publish">
      <h2 id="publish" className="font-display text-2xl">
        2. Publish
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">Nothing is shared until you choose to. Each choice below can be undone.</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-card p-5">
          <h3 className="font-display text-xl">Your station page</h3>
          <p className="mt-1 text-sm text-muted">
            {station.is_public
              ? "Public. Anyone with the link can see current and past readings, and it is listed on the Stations page."
              : "Private. Only you and the administrators can see it."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={btnPrimary}
              onClick={async () => {
                try {
                  await editStation({ data: { id: station.id, isPublic: !station.is_public } });
                  toast.success(station.is_public ? "Now private" : "Now public");
                  onChanged();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not change it");
                }
              }}
            >
              {station.is_public ? "Make private" : "Publish this station"}
            </button>
            <Link to="/stations/$slug" params={{ slug: station.slug }} className={btnGhost}>
              Open the page
            </Link>
          </div>
          {station.is_public ? <CopyBlock label="Share this link" text={page} /> : null}
        </div>

        <div className="rounded-2xl border border-line bg-card p-5">
          <h3 className="font-display text-xl">Share on the NCAR network</h3>
          <p className="mt-1 text-sm text-muted">
            We do not send your data to NCAR for you. This gives their team everything they need to list or pull it, and it
            only works once your station page is public.
          </p>
          <ul className="mt-3 grid gap-2 text-sm">
            <li>
              <span className="font-medium">CHORDS portal.</span> Send the request below to the portal's owner. Your data is
              already served in the CHORDS format, so they can read it with a standard CHORDS importer.
            </li>
            <li>
              <span className="font-medium">GDEX archive.</span>{" "}
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={gdex} onChange={(e) => patchAnswers({ gdex: e.target.checked })} />
                I want this station archived (a note for your plan, nothing is sent)
              </label>
            </li>
          </ul>
          {station.is_public ? (
            <CopyBlock label="Request to copy into an email" text={request} />
          ) : (
            <p className="mt-3 text-sm text-copper">Publish the station page first.</p>
          )}
          <a
            className="mt-3 inline-block text-sm text-kelp underline underline-offset-4"
            href="https://earthcubeprojects-chords.github.io/chords-docs/portals/"
          >
            Live CHORDS portals ↗
          </a>
        </div>
      </div>
    </section>
  );
}
