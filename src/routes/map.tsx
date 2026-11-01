import { Link, createFileRoute } from "@tanstack/react-router";
import { NetworkMap } from "@/components/network-map";

export const Route = createFileRoute("/map")({
  head: () => ({ meta: [{ title: "Network map — OpenIoTwx" }] }),
  component: MapPage,
});

function MapPage() {
  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-sm text-kelp-deep">Network</p>
      <h1 className="mt-1 font-display text-4xl">Network map</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Every station that is sharing its data, live. Sign in to see your own stations too.{" "}
        <Link to="/stations" className="text-kelp underline">
          Browse as a list
        </Link>
        .
      </p>
      <div className="mt-6">
        <NetworkMap />
      </div>
    </main>
  );
}
