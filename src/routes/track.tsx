import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CopyBlock, Notice, RequireUser, StatusDot, TimeChart, btnGhost, btnPrimary } from "@/components/platform-ui";
import { FlowSteps } from "@/components/flow-steps";
import { listMyStations, stationView } from "@/lib/platform/api";
import { parseChordsData } from "@/lib/platform/chords-format.ts";
import { CREDIT_ALIASES, forecastFromObservations, standInForecast, type Pt } from "@/lib/platform/forecast.ts";
import { ago, useAsync } from "@/lib/platform/hooks";
import { metricInfo, RANGES, type Range } from "@/lib/platform/metrics";
import { COMPUTE_PATHS } from "@/lib/place/compute-paths";
import { useWorkspace } from "@/lib/place/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/track")({
  head: () => ({ meta: [{ title: "Step 4: Track and Forecast — OpenIoTwx" }] }),
  validateSearch: (q: Record<string, unknown>) => ({ station: typeof q.station === "string" ? q.station : undefined }),
  component: () => (
    <RequireUser>
      <Track />
    </RequireUser>
  ),
});

function Track() {
  const { station: wanted } = Route.useSearch();
  const mine = useAsync(() => listMyStations(), []);
  const slug = wanted ?? mine.data?.[0]?.slug;
  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <FlowSteps current={4} station={slug} />
      <h1 className="font-display text-4xl sm:text-5xl">Track and Forecast</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Watch the station's history and latest readings on its own website, then look a day ahead: with the built-in
        stand-in, or with a CREDIT run on your own computer or NCAR CIRRUS.
      </p>
      {mine.error ? <div className="mt-4"><Notice>{mine.error}</Notice></div> : null}
      {mine.data && !mine.data.length ? (
        <p className="mt-6 rounded-2xl border border-line bg-card p-5 text-sm">
          No stations yet. Register one in{" "}
          <Link to="/deploy" search={{ station: undefined }} className="text-kelp underline underline-offset-4">
            step 3
          </Link>{" "}
          first.
        </p>
      ) : null}
      {mine.data?.length ? (
        <>
          <label className="mt-6 block text-sm text-muted">
            Station
            <select
              value={slug}
              onChange={(e) => (window.location.href = `/track?station=${encodeURIComponent(e.target.value)}`)}
              className="mt-1 block min-h-11 w-full max-w-sm rounded-xl border border-line bg-card px-3 text-ink"
            >
              {mine.data.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {slug ? <Station slug={slug} /> : null}
        </>
      ) : null}
    </main>
  );
}

function Station({ slug }: { slug: string }) {
  const [range, setRange] = useState<Range>("7d");
  const [metric, setMetric] = useState<string | undefined>();
  const view = useAsync(() => stationView({ data: { slug, range, metric } }), [slug, range, metric], 15000);
  const d = view.data;
  if (!d) return <p className="mt-6 text-muted">{view.loading ? "Loading…" : "Station not found."}</p>;
  const { station, series } = d;
  const active = d.metric;
  const info = active ? metricInfo(active) : null;
  const values = Object.entries(station.last_values);

  return (
    <div className="mt-6 grid gap-10">
      <section aria-labelledby="site">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="site" className="font-display text-2xl">
              {station.name}
            </h2>
            <p className="text-sm text-muted">
              {station.is_public ? "Public page" : "Private (publish it in step 3 to share)"} · last heard {ago(station.last_seen_at)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusDot station={station} />
            <Link to="/stations/$slug" params={{ slug: station.slug }} className={btnGhost}>
              Open the full page
            </Link>
          </div>
        </div>

        {values.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {values.map(([k, x]) => {
              const m = metricInfo(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={k === active}
                  onClick={() => setMetric(k)}
                  className={cn("rounded-2xl border bg-card p-3 text-left", k === active ? "border-kelp" : "border-line")}
                >
                  <p className="text-xs text-muted">{m.label}</p>
                  <p className="mt-1 font-display text-2xl tabular-nums">
                    {Math.round(x.v * 100) / 100}
                    <span className="ml-1 text-sm text-muted">{m.unit}</span>
                  </p>
                  <p className="text-xs text-muted">{ago(x.t)}</p>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl border border-line bg-card p-4 text-sm text-muted">
            Nothing received yet. Finish{" "}
            <Link to="/deploy" search={{ station: station.slug }} className="text-kelp underline underline-offset-4">
              step 3
            </Link>{" "}
            and the readings will appear here.
          </p>
        )}
      </section>

      {active && info ? (
        <Forecast
          station={station}
          metric={active}
          label={info.label}
          unit={info.unit}
          series={series}
          range={range}
          setRange={setRange}
        />
      ) : null}

      <p className="text-sm text-muted">
        Looking for the place around the station, such as vulnerability and environmental justice layers?{" "}
        <Link to="/analysis" className="text-kelp underline underline-offset-4">
          Open the analysis
        </Link>
        .
      </p>
    </div>
  );
}

type Series = NonNullable<Awaited<ReturnType<typeof stationView>>>["series"];
type St = NonNullable<Awaited<ReturnType<typeof stationView>>>["station"];

function Forecast({
  station,
  metric,
  label,
  unit,
  series,
  range,
  setRange,
}: {
  station: St;
  metric: string;
  label: string;
  unit: string;
  series: Series;
  range: Range;
  setRange: (r: Range) => void;
}) {
  const { prefs, setPrefs } = useWorkspace();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [uploaded, setUploaded] = useState<Pt[] | null>(null);
  const [fileName, setFileName] = useState("");

  // A loaded forecast belongs to one variable; changing it drops the file.
  useEffect(() => setUploaded(null), [metric, station.id]);

  const standIn = useMemo(() => standInForecast(series.map((p) => ({ t: p.t, avg: p.avg }))), [series]);
  const shown = uploaded ?? (prefs.compute === "browser" ? standIn : []);
  const caption = uploaded ? `the forecast from ${fileName}` : "the built-in stand-in (a repeat of yesterday's cycle, not a CREDIT run)";
  const exportBase = `${origin}/instruments/${station.chords_id}`;
  const place = station.latitude != null && station.longitude != null ? { lat: station.latitude, lon: station.longitude } : null;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 19);
  const path = COMPUTE_PATHS.find((p) => p.id === prefs.compute)!;

  return (
    <section aria-labelledby="forecast">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="forecast" className="font-display text-2xl">
          {label}: history and the next day
        </h2>
        <div className="flex gap-1" role="group" aria-label="History range">
          {(["24h", "7d", "30d"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === range}
              onClick={() => setRange(r)}
              className={cn("min-h-9 rounded-full px-3 text-xs", r === range ? "bg-kelp text-paper" : "border border-line bg-card")}
            >
              {RANGES[r].label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <TimeChart points={series} unit={unit} label={label} forecast={shown} forecastLabel={caption} />
      </div>

      <h3 className="mt-8 font-display text-xl">Run CREDIT</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        CREDIT is NCAR's AI Earth-system model. It forecasts the whole globe from its own starting conditions, so it does not read
        your station's readings. Your station gives it the one thing it needs: where it is. The forecast for the model's grid point
        nearest your station is then drawn beside what the station measured, so you can see how good it is at this spot.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {COMPUTE_PATHS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={prefs.compute === p.id}
            onClick={() => setPrefs({ ...prefs, compute: p.id })}
            className={cn("rounded-2xl border px-4 py-4 text-left", prefs.compute === p.id ? "border-kelp bg-moss" : "border-line bg-card")}
          >
            <span className="font-display text-lg">{p.id === "browser" ? "Local (this computer)" : p.title}</span>
            <span className="mt-1 block text-sm text-muted">{p.body}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-card p-5">
          <h4 className="font-medium">1. Tell the run where your station is</h4>
          {place ? (
            <p className="mt-1 text-sm">
              <span className="text-muted">Latitude, longitude: </span>
              <span className="font-mono tabular-nums">
                {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-copper">
              This station has no location yet.{" "}
              <Link to="/stations/$slug" params={{ slug: station.slug }} className="underline underline-offset-4">
                Add it on the station's page
              </Link>
              .
            </p>
          )}
          <p className="mt-3 text-sm text-muted">
            {prefs.compute === "cirrus"
              ? "The Mesonet example runs CREDIT on CIRRUS for a chosen date and number of days, takes the model grid point nearest each station's latitude and longitude, and writes temperature, humidity, pressure, wind speed and wind direction every 6 hours. The copy of it in your v2 folder cuts out a Colorado box only (about 37–41°N, 102–109°W), so a station elsewhere needs that changed first."
              : prefs.compute === "boinc"
                ? "A BOINC job would be one CREDIT run. The station's location picks the grid point, exactly as above. This needs a BOINC project your community hosts."
                : "Run CREDIT on your own computer for the days you want (its repository has the instructions). The station's location is what you pick out of the result."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <a className="text-kelp underline underline-offset-4" href="https://github.com/NCAR/miles-credit">
              CREDIT model ↗
            </a>
            <a className="text-kelp underline underline-offset-4" href="https://github.com/NCAR/mesonet-siparcs25/tree/main">
              Mesonet example ↗
            </a>
            {prefs.compute === "boinc" ? (
              <a className="text-kelp underline underline-offset-4" href="https://boinc.berkeley.edu/">
                BOINC ↗
              </a>
            ) : null}
          </div>
          <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
            To check a forecast against reality in your own tools, download this station's last 30 days:{" "}
            <a className="text-kelp underline underline-offset-4" href={`${exportBase}.csv?start=${since}`}>
              CSV
            </a>{" "}
            ·{" "}
            <a className="text-kelp underline underline-offset-4" href={`${exportBase}.json?start=${since}`}>
              JSON
            </a>
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-card p-5">
          <h4 className="font-medium">2. Show the forecast it produced</h4>
          <p className="mt-1 text-sm text-muted">
            Choose the result as CSV (save the run's Excel files as CSV first). It can be one column for this station, or the whole
            grid with latitude and longitude, where the point nearest your station is used. Pick several files at once, such as one
            per 6 hours. Columns named <code>temperature</code>, <code>humidity</code>, <code>pressure</code>, <code>wind_speed</code>{" "}
            or <code>wind_direction</code> are matched to {label}. Read in your browser, never uploaded.
          </p>
          <input
            type="file"
            multiple
            accept=".csv,.json,text/csv,application/json"
            aria-label="Forecast file"
            className="mt-3 block w-full text-sm"
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              if (!files.length) return;
              const obs = (await Promise.all(files.map(async (f) => parseChordsData(await f.text(), f.type)))).flat();
              const pts = forecastFromObservations(obs, metric, place ?? undefined);
              if (!pts.length) {
                toast.error(
                  place
                    ? `Could not find ${label} in that file. It needs a time column and a column for it (named ${metric} or ${(CREDIT_ALIASES[metric] ?? ["like the model's name"])[0]}).`
                    : "Could not read a forecast from that file. If it holds the whole grid, add this station's location first so the nearest point can be chosen.",
                );
                return;
              }
              setUploaded(pts);
              setFileName(files.length === 1 ? files[0].name : `${files.length} files`);
              toast.success(`Loaded ${pts.length} forecast points`);
            }}
          />
          {uploaded ? (
            <button className={`${btnGhost} mt-3`} onClick={() => setUploaded(null)}>
              Go back to {prefs.compute === "browser" ? "the stand-in" : "no forecast"}
            </button>
          ) : null}
          <p className="mt-3 text-sm text-muted">
            Now showing {shown.length ? caption : `no forecast (${path.title} selected). Load a file to see one.`}
          </p>
        </div>
      </div>

      <CopyBlock label="Address a program can read the history from" text={`${exportBase}.csv?start=${since}`} />
      <div className="mt-6">
        <Link to="/stations/$slug" params={{ slug: station.slug }} className={btnPrimary}>
          Open the station's own page
        </Link>
      </div>
    </section>
  );
}
