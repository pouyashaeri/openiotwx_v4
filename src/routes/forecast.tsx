import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LineChart } from "@/components/charts";
import { ConnectionsPanel } from "@/components/connections-panel";
import { DecisionCards } from "@/components/decision-cards";
import { LocationPicker } from "@/components/location-picker";
import { usePlaceData } from "@/lib/place/use-place-data";
import { api, type ComputeStatus, type ForecastRun } from "@/lib/connect/api";
import { useConnections } from "@/lib/connect/settings";
import { BACKENDS, VARIABLES, backendLabel, type BackendId } from "@/lib/forecast/credit";
import { useStationData } from "@/lib/forecast/use-station-data";
import { decide } from "@/lib/place/decide";
import { TOOLS } from "@/lib/wizard/catalog";
import { useDraft } from "@/lib/wizard/store";
import { hasLocation, type SurpriseId } from "@/lib/wizard/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/forecast")({
  head: () => ({ meta: [{ title: "Forecast — OpenIoTwx" }] }),
  component: ForecastPage,
});

const LEADS = [
  { hours: 48, label: "2 days" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

/** Threshold lines per variable, from the decision rules, shown only for concerns the plan named. */
function linesFor(variable: string, concerns: SurpriseId[]) {
  const lines: Array<{ at: number; label: string }> = [];
  if (variable === "t" && concerns.includes("heat")) lines.push({ at: 32, label: "heat watch 32 °C" }, { at: 38, label: "act 38 °C" });
  if (variable === "pm25" && (concerns.includes("air") || concerns.includes("fire"))) lines.push({ at: 35.5, label: "sensitive groups" }, { at: 55.5, label: "unhealthy" });
  if (variable === "wind" && (concerns.includes("storm") || concerns.includes("fire"))) lines.push({ at: 14, label: "advisory 14 m/s" });
  if (variable === "rh" && concerns.includes("fire")) lines.push({ at: 25, label: "fire weather 25%" }, { at: 15, label: "red flag 15%" });
  if (variable === "rain" && concerns.includes("water")) lines.push({ at: 12.5, label: "watch 12.5 mm/h" });
  return lines;
}

function ForecastPage() {
  const hydrated = useDraft((state) => state.hydrated);
  const hydrate = useDraft((state) => state.hydrate);
  const answers = useDraft((state) => state.answers);
  const siteName = useDraft((state) => state.siteName);
  const connections = useConnections();
  const place = usePlaceData();
  const station = useStationData();
  const [backend, setBackend] = useState<BackendId>(answers.resources.includes("compute") ? "boinc" : "local");
  const [lead, setLead] = useState(48);
  const [runs, setRuns] = useState<ForecastRun[]>([]);
  const [compute, setCompute] = useState<ComputeStatus[]>([]);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    hydrate();
    connections.hydrate();
  }, [hydrate, connections]);

  useEffect(() => {
    if (!connections.hydrated) return;
    let cancelled = false;
    void Promise.all([api.forecastRuns(connections.apiUrl), api.compute(connections.apiUrl)]).then(([r, c]) => {
      if (cancelled) return;
      setRuns(r.ok ? r.data : []);
      setCompute(c.ok ? c.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [connections.hydrated, connections.apiUrl]);

  if (!hydrated) {
    return <p className="mx-auto max-w-5xl px-4 py-16 text-muted">Opening your draft…</p>;
  }

  const located = hasLocation(answers.location);
  const cards = decide({
    concerns: answers.surprises,
    who: answers.who,
    svi: place.svi,
    ej: place.ej,
    now: station.now,
    forecast: station.forecast,
    silentMinutes: station.silentMinutes,
  });

  async function request() {
    if (!located) {
      toast.error("Set the site location first. The forecast is for one grid point.");
      return;
    }
    setRequesting(true);
    const result = await api.requestForecast(connections.apiUrl, {
      latitude: answers.location.lat!,
      longitude: answers.location.lon!,
      lead_hours: lead,
      backend,
      station_id: station.station?.station_id,
    });
    setRequesting(false);
    if (result.ok) {
      setRuns((r) => [result.data, ...r]);
      toast.success(`Forecast queued on ${backendLabel(backend)}. The chart updates when the run lands.`);
    } else {
      toast.error(`The server did not take the request: ${result.error} Check the address below.`);
    }
  }

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="eyebrow">Forecast and decision analysis</p>
      <h1 className="mt-2 text-4xl sm:text-5xl">{siteName ? `What is coming to ${siteName}` : "What is coming, and what to do about it."}</h1>
      <p className="mt-3 max-w-2xl text-muted">
        {TOOLS.credit.name} is NSF NCAR's AI Earth-system model. Here it runs for the point your station stands on,
        the way the mesonet-siparcs25 service ran it, and the result is drawn against what the station recorded.
        Nobody needs to become a modeler: pick where the work runs, ask for a run, read the cards.
      </p>

      {!located ? (
        <div className="no-print mt-6 rounded-lg border border-line bg-panel px-4 py-4">
          <p className="font-medium">A forecast is for one place. Put the station on the map first.</p>
          <LocationPicker compact />
        </div>
      ) : null}

      <section className="mt-8" aria-labelledby="run-title">
        <h2 id="run-title" className="text-2xl">
          Where the forecast runs
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Three places can do the same work. The community decides which; the plan does not depend on any one of
          them, which is the point of running your own stack.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {BACKENDS.map((b) => {
            const status = compute.find((c) => c.backend === b.id);
            const selected = backend === b.id;
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setBackend(b.id)}
                className={cn(
                  "flex flex-col justify-start rounded-lg border px-4 py-4 text-left transition-colors",
                  selected ? "border-brand bg-brand-soft" : "border-line bg-panel hover:border-brand",
                )}
              >
                <p className="text-lg leading-tight">{b.name}</p>
                <p className="mt-1 text-sm text-muted">{b.who}</p>
                <p className="mt-3 text-sm">{b.how}</p>
                <dl className="mt-3 grid gap-1 text-xs text-muted">
                  <div>
                    <dt className="inline">Costs: </dt>
                    <dd className="inline">{b.cost}</dd>
                  </div>
                  <div>
                    <dt className="inline">Needs: </dt>
                    <dd className="inline">{b.needs}</dd>
                  </div>
                </dl>
                <p className="mt-3 flex items-center gap-2 text-xs">
                  <span className={cn("size-2 rounded-full", status?.available ? "bg-brand" : "bg-line")} aria-hidden="true" />
                  {status ? status.detail : "Status unknown until the community server answers."}
                  {status?.volunteers !== undefined ? ` ${status.volunteers} volunteer machine${status.volunteers === 1 ? "" : "s"}.` : ""}
                </p>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <fieldset className="flex gap-2">
            <legend className="sr-only">Lead time</legend>
            {LEADS.map((l) => (
              <button
                key={l.hours}
                type="button"
                aria-pressed={lead === l.hours}
                onClick={() => setLead(l.hours)}
                className={cn("min-h-11 rounded-md border px-4 text-sm", lead === l.hours ? "border-brand bg-brand-soft" : "border-line bg-panel")}
              >
                {l.label}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            onClick={request}
            disabled={requesting}
            className="min-h-11 rounded-md bg-brand px-5 text-sm font-medium text-surface disabled:opacity-50"
          >
            {requesting ? "Sending…" : `Request a ${lead / 24}-day forecast`}
          </button>
          <p className="text-sm text-muted">
            {backendLabel(backend)}{located ? `, for ${answers.location.label}.` : ". No location yet."} A 6-hourly CREDIT rollout, initialized from the latest GFS analysis.
          </p>
        </div>

        {runs.length ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Requested</th>
                  <th className="px-3 py-2 font-medium">Where</th>
                  <th className="px-3 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Pinned copy</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 8).map((run) => (
                  <tr key={run.id} className="border-t border-line">
                    <td className="px-3 py-2 tabular-nums">{new Date(run.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="px-3 py-2">{backendLabel(run.backend)}</td>
                    <td className="px-3 py-2">{run.lead_hours} h</td>
                    <td className="px-3 py-2">{run.status}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{run.cid ? `ipfs://${run.cid.slice(0, 12)}…` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="mt-10" aria-labelledby="chart-title">
        <h2 id="chart-title" className="text-2xl">
          History, now, and forecast
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {station.note} Temperature, pressure, and wind come from CREDIT; rain and fine particles come from the GFS and
          HRRR feeds the server already pulls to initialize it. Threshold lines belong to the concerns named in the plan.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {VARIABLES.map((v) => (
            <LineChart
              key={v.id}
              label={`${v.label}${v.fromCredit ? "" : " (GFS/HRRR)"}`}
              unit={v.unit}
              history={station.history[v.id] ?? []}
              forecast={(station.forecast[v.id] ?? []).slice(0, lead)}
              lines={linesFor(v.id, answers.surprises)}
            />
          ))}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="cards-title">
        <h2 id="cards-title" className="text-2xl">
          Decision cards
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          One card per concern from the wizard, judged on the forecast above and the place profile. Each card names the
          threshold it used so the group can keep it or change it.{" "}
          <Link to="/analysis" className="text-brand-deep underline underline-offset-4">
            The place profile
          </Link>{" "}
          explains the exposure lines.
        </p>
        <div className="mt-4">
          <DecisionCards cards={cards} />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="pool-title">
        <h2 id="pool-title" className="text-2xl">
          Sharing the work
        </h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-4">
            <p className="font-medium">Lend an idle computer ({TOOLS.boinc.name})</p>
            <ol className="mt-2 grid gap-2 text-sm text-muted">
              <li className="flex gap-2">
                <span className="font-mono text-brand">1</span>
                Install the BOINC client from boinc.berkeley.edu (Windows, macOS, Linux, or the docker image in infra/boinc).
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-brand">2</span>
                Add project: the community server's address and the account key the steward shares from the Community page.
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-brand">3</span>
                Leave it on. Work units are small tiles of the forecast; each is checked twice before it counts.
              </li>
            </ol>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-4">
            <p className="font-medium">Keep copies ({TOOLS.ipfs.name})</p>
            <p className="mt-2 text-sm text-muted">
              Every finished forecast and every monthly export is pinned on the community's IPFS node and gets a content
              address (the CID column above). Another community can pin the same files; nobody has to ask the first server
              for them again.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-4">
            <p className="font-medium">Grow when it is time</p>
            <p className="mt-2 text-sm text-muted">
              The compose stack becomes a helm release on {TOOLS.cirrus.name} or an OpenStack cloud without changing the
              code. Petals-style sharding is the path for larger models later: the forecast service already treats compute
              as a pool of workers, not one machine.
            </p>
          </div>
        </div>
      </section>

      <ConnectionsPanel className="mt-8" />
    </main>
  );
}
