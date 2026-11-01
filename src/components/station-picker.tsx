import { Link } from "@tanstack/react-router";
import { AddStation } from "@/components/add-station";
import { SelectBox } from "@/components/select-box";
import { btnGhost } from "@/components/platform-ui";
import { ago } from "@/lib/platform/hooks";
import type { StationRow } from "@/lib/platform/service.server";

/**
 * The "Station" control on the Deploy and Track pages: the themed dropdown, and a way to register another
 * station without leaving the page. `onChanged` reloads the list; `onPick` switches the page to a station.
 */
export function StationPicker({
  stations,
  current,
  onPick,
  onChanged,
}: {
  stations: Pick<StationRow, "slug" | "name" | "last_seen_at">[];
  current: string | undefined;
  onPick: (slug: string) => void;
  onChanged: () => unknown;
}) {
  return (
    <div className="mt-6">
      <p className="text-sm text-muted">Station</p>
      <div className="mt-1">
        <SelectBox
          label="Station"
          value={current}
          onChange={onPick}
          options={stations.map((s) => ({
            value: s.slug,
            label: s.name,
            hint: s.last_seen_at ? `Last reading ${ago(s.last_seen_at)}` : "Waiting for its first reading",
          }))}
        />
      </div>
      <details className="group mt-3 text-sm">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-kelp underline-offset-4 hover:underline">
          <span aria-hidden="true" className="transition-transform group-open:rotate-45">
            +
          </span>
          Register another station
        </summary>
        <div className="mt-3 rounded-2xl border border-line bg-card p-4">
          <AddStation
            onAdded={async (slug) => {
              await onChanged();
              onPick(slug);
            }}
          />
        </div>
      </details>
    </div>
  );
}

/** Shown when the account has no stations: why, and how to get one. */
export function NoStations({ onChanged, onPick }: { onChanged: () => unknown; onPick: (slug: string) => void }) {
  return (
    <section className="mt-6 rounded-2xl border border-line bg-card p-5" aria-labelledby="no-stations">
      <h2 id="no-stations" className="font-display text-2xl">
        No stations in your account yet
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        A station only shows up here once it is registered to your account. Flashing a board writes its settings onto the board; registering is what gives
        it a key and a page, and what lets its readings arrive. Register the stations from your plan, or add the one you just flashed.
      </p>
      <div className="mt-4">
        <Link to="/plan" className={btnGhost}>
          Register my plan&apos;s stations
        </Link>
      </div>
      <div className="mt-5 border-t border-line pt-5">
        <p className="mb-3 text-sm font-medium">Or add one now</p>
        <AddStation
          onAdded={async (slug) => {
            await onChanged();
            onPick(slug);
          }}
        />
      </div>
    </section>
  );
}
