import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { LineChart } from "@/components/charts";
import { DecisionCards } from "@/components/decision-cards";
import { LocationPicker } from "@/components/location-picker";
import { PlaceDashboard } from "@/components/place-dashboard";
import { usePlaceData } from "@/lib/place/use-place-data";
import { PortalSection } from "@/components/portal-section";
import { VARIABLES } from "@/lib/forecast/credit";
import { useStationData } from "@/lib/forecast/use-station-data";
import { decide } from "@/lib/place/decide";
import { useDraft } from "@/lib/wizard/store";

export const Route = createFileRoute("/analysis")({
  head: () => ({ meta: [{ title: "Analysis — OpenIoTwx" }] }),
  component: AnalysisPage,
});

function AnalysisPage() {
  const hydrated = useDraft((state) => state.hydrated);
  const hydrate = useDraft((state) => state.hydrate);
  const answers = useDraft((state) => state.answers);
  const siteName = useDraft((state) => state.siteName);
  const place = usePlaceData();
  const station = useStationData();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return <p className="mx-auto max-w-5xl px-4 py-16 text-muted">Opening your draft…</p>;
  }

  const cards = decide({
    concerns: answers.surprises,
    who: answers.who,
    svi: place.svi,
    ej: place.ej,
    now: station.now,
    forecast: station.forecast,
    silentMinutes: station.silentMinutes,
  });
  const measured = VARIABLES.filter((v) => (station.history[v.id]?.length ?? 0) > 1);

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="eyebrow">Analysis</p>
      <h1 className="mt-2 text-4xl sm:text-5xl">{siteName ? `${siteName}, in context` : "See the place, then see the readings."}</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Two public datasets say who lives here and what they already breathe. Your station says what is happening now.
        The decision cards put the three together, and the portal keeps all of it in a database you run.
      </p>

      {!answers.intent ? (
        <p className="no-print mt-4 rounded-lg border border-line bg-brand-soft px-4 py-3 text-sm">
          No draft yet, so this page shows a sample. {" "}
          <Link to="/wizard" className="text-brand-deep underline underline-offset-4">
            Start the wizard
          </Link>{" "}
          to make it about your place.
        </p>
      ) : null}

      {!place.located ? (
        <div className="no-print mt-6 rounded-lg border border-line bg-panel px-4 py-4">
          <p className="font-medium">Put the station on the map to replace the sample with the real tract.</p>
          <LocationPicker compact />
        </div>
      ) : null}

      <div className="mt-8">
        <PlaceDashboard />
      </div>

      <section className="mt-10" aria-labelledby="analysis-decisions">
        <p className="eyebrow">Decision support</p>
        <h2 id="analysis-decisions" className="mt-1 text-2xl">
          Where each concern stands today
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{station.note}</p>
        <div className="mt-4">
          <DecisionCards cards={cards} />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="analysis-readings">
        <p className="eyebrow">The last three days</p>
        <h2 id="analysis-readings" className="mt-1 text-2xl">
          What the station recorded
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Solid lines are readings; the dashed tail is the latest forecast, which the Forecast page explains. The same
          series are in Metabase for anything these charts do not answer.
        </p>
        {measured.length ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {measured.map((v) => (
              <LineChart
                key={v.id}
                label={v.label}
                unit={v.unit}
                history={station.history[v.id] ?? []}
                forecast={(station.forecast[v.id] ?? []).slice(0, 24)}
                height={160}
              />
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted">
            {station.status === "loading" ? "Loading readings…" : "No readings on the server yet. Finish the build, point the station at the broker, and this fills in."}
          </p>
        )}
      </section>

      <div className="mt-10">
        <PortalSection />
      </div>
    </main>
  );
}
