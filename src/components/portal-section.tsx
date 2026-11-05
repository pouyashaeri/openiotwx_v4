import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { ConnectionsPanel } from "@/components/connections-panel";
import { LiveFeed } from "@/components/live-feed";
import { api, type Station } from "@/lib/connect/api";
import { cleanUrl, useConnections } from "@/lib/connect/settings";
import { TOOLS } from "@/lib/wizard/catalog";
import { useDraft } from "@/lib/wizard/store";
import { cn } from "@/lib/utils";

const DEPLOY_STEPS = [
  {
    title: "Run the stack",
    body: "On the host: `cd infra && cp .env.example .env && docker compose up -d`. That starts the MQTT broker, the database, the API, and Metabase. A Raspberry Pi 4 is enough for a handful of stations.",
  },
  {
    title: "Point the station at it",
    body: "The flasher asks for the broker address and a topic. Use the host's address and `ncar/iotwx/<state>/<place>/<station>`. The listener turns every message into a row.",
  },
  {
    title: "Open the portal",
    body: "Metabase builds a collection per station: readings, the place profile, and forecasts in one place. Pin the dashboard and share its public link with the people who asked for a picture.",
  },
];

/**
 * The data portal. Plots come from Metabase over the community's own database, the way
 * mesonet-siparcs25 set it up; the live feed shows the MQTT messages before they land.
 * The decision toolkit is the same database with the place profile and forecasts joined in.
 */
export function PortalSection({ compact = false }: { compact?: boolean }) {
  const connections = useConnections();
  const siteName = useDraft((state) => state.siteName);
  const [stations, setStations] = useState<Station[] | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  useEffect(() => {
    connections.hydrate();
  }, [connections]);

  useEffect(() => {
    if (!connections.hydrated) return;
    let cancelled = false;
    void api.stations(connections.apiUrl).then((result) => {
      if (cancelled) return;
      setServerOk(result.ok);
      setStations(result.ok ? result.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [connections.hydrated, connections.apiUrl]);

  const metabase = cleanUrl(connections.metabaseUrl);
  const dashboard = cleanUrl(connections.metabaseDashboard);

  return (
    <section aria-labelledby="portal-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Deployment and data portal</p>
          <h2 id="portal-title" className="mt-1 text-2xl">
            Where the readings go, and how you see them
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Your own broker and database, with {TOOLS.metabase.name} for plots and questions. The same containers
            run on a Raspberry Pi, a spare PC, or NCAR CIRRUS.
          </p>
        </div>
        {compact ? (
          <Link to="/analysis" className="no-print inline-flex min-h-10 items-center rounded-md bg-brand px-3 text-sm text-surface transition-[filter] duration-150 not-disabled:hover:brightness-110">
            Open the portal page
          </Link>
        ) : null}
      </div>

      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {DEPLOY_STEPS.map((step, index) => (
          <li key={step.title} className="rounded-lg border border-line bg-panel px-4 py-3">
            <p className="flex items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand-soft font-mono text-xs text-brand-deep">{index + 1}</span>
              <span className="font-medium">{step.title}</span>
            </p>
            <p className="mt-2 text-sm text-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={metabase || "#"}
          className={cn("inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-4 text-sm text-surface transition-[filter] duration-150 hover:brightness-110", !metabase && "pointer-events-none opacity-50")}
        >
          Open Metabase
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
        {metabase ? (
          <a href={`${metabase}/collection/root`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep">
            Station collections
          </a>
        ) : null}
        <span className="text-sm text-muted">
          {serverOk === null
            ? "Checking the community server…"
            : serverOk
              ? `Community server up. ${stations?.length ?? 0} station${stations?.length === 1 ? "" : "s"} registered${stations?.length ? `: ${stations.map((s) => s.station_id).slice(0, 4).join(", ")}${stations.length > 4 ? "…" : ""}` : ""}.`
              : "Community server not reachable from this browser. The buttons still open Metabase once the stack is running."}
        </span>
      </div>

      {dashboard ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <iframe
            src={dashboard}
            title={`Metabase dashboard for ${siteName || "the station"}`}
            className="h-[28rem] w-full bg-surface"
            loading="lazy"
            allowFullScreen
            // The dashboard may run its own scripts, but it cannot navigate this page away.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}

      {!compact ? (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <LiveFeed />
            <div className="rounded-lg border border-line bg-panel px-4 py-4">
              <h3 className="font-medium">The decision toolkit, in the database</h3>
              <p className="mt-2 text-sm text-muted">
                The loader keeps three tables beside the readings: <code>svi_tracts</code> (CDC/ATSDR 2022), <code>ej_indicators</code> (EJScreen via EJAM), and <code>credit_forecasts</code>. The view <code>station_context</code> joins each station to its tract, so a Metabase question can ask things like:
              </p>
              <ul className="mt-3 grid gap-2 text-sm">
                <li className="rounded-md bg-surface px-3 py-2">Hours above 35 °C last month, by station, next to the share of residents over 65 in that tract.</li>
                <li className="rounded-md bg-surface px-3 py-2">PM2.5 recorded vs. the EJScreen PM2.5 percentile, so the station can confirm or correct the estimate.</li>
                <li className="rounded-md bg-surface px-3 py-2">Forecast high vs. recorded high for the last ten runs, to see how far to trust the model here.</li>
                <li className="rounded-md bg-surface px-3 py-2">Rain in the last 24 hours against the flood watch line, filtered to tracts flagged for mobile homes or no vehicle.</li>
              </ul>
              <p className="mt-3 text-xs text-muted">
                The orchestrator creates these as saved questions in the Decision toolkit collection. Edit them in Metabase; the SQL is in <code>infra/services/metabase_orch/questions.sql</code>.
              </p>
            </div>
          </div>
          <ConnectionsPanel className="mt-4" />
        </>
      ) : null}
    </section>
  );
}
