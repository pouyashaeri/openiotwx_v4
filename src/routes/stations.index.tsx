import { createFileRoute } from "@tanstack/react-router";
import { StationCard } from "@/components/platform-ui";
import { publicStations } from "@/lib/platform/api";
import { useAsync } from "@/lib/platform/hooks";

export const Route = createFileRoute("/stations/")({
  head: () => ({ meta: [{ title: "Stations — OpenIoTwx" }] }),
  component: Stations,
});

function Stations() {
  const { data, loading, error } = useAsync(() => publicStations(), [], 30000);
  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-sm text-kelp-deep">Network</p>
      <h1 className="mt-1 font-display text-4xl">Stations sharing data</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Only stations whose owners chose to share appear here. Sharing is a switch on each station.
      </p>
      {error ? <p className="mt-4 text-sm text-copper">{error}</p> : null}
      {data?.length ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <StationCard key={s.id} station={s} />
          ))}
        </div>
      ) : (
        <p className="mt-6 text-muted">{loading ? "Loading…" : "No public stations yet."}</p>
      )}
    </main>
  );
}
