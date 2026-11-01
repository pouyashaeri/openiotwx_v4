import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { RankBar } from "@/components/charts";
import { ejscreenMapUrl } from "@/lib/place/ej";
import { ordinal, pctile } from "@/lib/place/format";
import { usePlaceData } from "@/lib/place/use-place-data";
import { rankBand } from "@/lib/place/svi";
import { TOOLS } from "@/lib/wizard/catalog";
import { cn } from "@/lib/utils";

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-lg border px-4 py-3", warn ? "border-warn" : "border-line", "bg-panel")}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

export function PlaceDashboard({ compact = false }: { compact?: boolean }) {
  const data = usePlaceData();
  const { svi, ej } = data;
  const band = rankBand(svi?.overall ?? null);
  const topFactors = svi
    ? [...svi.factors].filter((f) => f.rank !== null).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, compact ? 4 : 8)
    : [];
  const topEnv = ej
    ? [...ej.environmental].filter((e) => e.usPercentile !== null).sort((a, b) => (b.usPercentile ?? 0) - (a.usPercentile ?? 0)).slice(0, compact ? 4 : 8)
    : [];

  return (
    <section aria-labelledby="place-dash-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Place profile</p>
          <h2 id="place-dash-title" className="mt-1 text-2xl">
            {svi?.location || data.label || "This place"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {data.isSample
              ? "Sample data. Add the site's location in the wizard review step to see the real tract."
              : data.status === "loading"
                ? "Reading the SVI tract and the EJScreen buffer…"
                : `${svi ? `Tract ${svi.fips}, ${svi.county} County, ${svi.state}. Population ${svi.population?.toLocaleString() ?? "—"}.` : ""} ${
                    ej ? `EJScreen buffer: ${ej.bufferMiles} mile.` : ""
                  }`}
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          {data.located ? (
            <button
              type="button"
              onClick={data.reload}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-sm"
            >
              <RefreshCw className={cn("size-4", data.status === "loading" && "animate-spin")} aria-hidden="true" />
              Refresh
            </button>
          ) : null}
          {compact ? (
            <Link to="/analysis" className="inline-flex min-h-10 items-center rounded-md bg-brand px-3 text-sm text-surface">
              Open the full analysis
            </Link>
          ) : null}
        </div>
      </div>

      {data.sviError || data.ejError ? (
        <div className="mt-3 grid gap-1 text-sm text-warn">
          {data.sviError ? <p>{data.sviError}</p> : null}
          {data.ejError ? <p>{data.ejError}</p> : null}
        </div>
      ) : null}

      <div className={cn("mt-4 grid gap-3 sm:grid-cols-2", !compact && "lg:grid-cols-4")}>
        <Tile
          label="Social vulnerability"
          value={svi ? pctile(svi.overall) : "—"}
          sub={svi ? `Overall, ${band.label.toLowerCase()} · ${svi.flagsTotal} of 16 factors in the top 10% nationally` : "No SVI yet"}
          warn={band.level === 3}
        />
        <Tile
          label="EJ demographic index"
          value={ej ? pctile(ej.demographicIndexPercentile, 100) : "—"}
          sub={ej ? `Supplemental index ${pctile(ej.supplementalIndexPercentile, 100)} · ${ej.population?.toLocaleString() ?? "—"} people within the buffer` : "No EJScreen yet"}
          warn={(ej?.demographicIndexPercentile ?? 0) >= 80}
        />
        <Tile
          label="Top environmental burden"
          value={topEnv[0] ? pctile(topEnv[0].usPercentile, 100) : "—"}
          sub={topEnv[0] ? `${topEnv[0].label}: ${topEnv[0].value}${topEnv[0].unit ? ` ${topEnv[0].unit}` : ""}` : "No EJScreen yet"}
          warn={(topEnv[0]?.usPercentile ?? 0) >= 80}
        />
        <Tile
          label="Most vulnerable theme"
          value={svi ? pctile(Math.max(...svi.themes.map((t) => t.rank))) : "—"}
          sub={svi ? svi.themes.reduce((a, b) => (b.rank > a.rank ? b : a)).label : "No SVI yet"}
          warn={Boolean(svi && Math.max(...svi.themes.map((t) => t.rank)) > 0.75)}
        />
      </div>

      <div className={cn("mt-5 grid gap-5", compact ? "lg:grid-cols-2" : "lg:grid-cols-3")}>
        <div className="rounded-lg border border-line bg-panel p-4">
          <h3 className="text-lg">Four SVI themes</h3>
          <p className="mt-1 text-xs text-muted">National percentile of the tract. Flags count factors in the top 10%.</p>
          <div className="mt-3 grid gap-3">
            {svi
              ? svi.themes.map((theme) => (
                  <RankBar key={theme.id} label={theme.label} value={theme.rank} detail={theme.flags ? `${theme.flags} flagged factor${theme.flags === 1 ? "" : "s"}` : undefined} />
                ))
              : null}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel p-4">
          <h3 className="text-lg">Who the weather falls on</h3>
          <p className="mt-1 text-xs text-muted">The SVI factors that rank highest here, with the share of people they describe.</p>
          <div className="mt-3 grid gap-3">
            {topFactors.map((f) => (
              <RankBar key={f.id} label={f.label} value={f.rank} flagged={f.flagged} detail={f.percent !== null ? `${f.percent.toFixed(1)}% of the tract` : undefined} />
            ))}
          </div>
        </div>

        <div className={cn("rounded-lg border border-line bg-panel p-4", compact && "lg:col-span-2")}>
          <h3 className="text-lg">Environmental burden already here</h3>
          <p className="mt-1 text-xs text-muted">EJScreen indicators ranked nationally. The station adds the measurement these percentiles only estimate.</p>
          <div className={cn("mt-3 grid gap-3", compact && "sm:grid-cols-2")}>
            {topEnv.map((e) => (
              <RankBar
                key={e.code}
                label={e.label}
                value={e.usPercentile}
                scale={100}
                detail={`${e.value}${e.unit ? ` ${e.unit}` : ""}${e.statePercentile !== null ? ` · ${ordinal(e.statePercentile)} in state` : ""}${e.ejIndexPercentile !== null ? ` · EJ index ${ordinal(e.ejIndexPercentile)}` : ""}`}
              />
            ))}
          </div>
          {!compact && ej?.demographic.length ? (
            <div className="mt-4 border-t border-line pt-3">
              <h4 className="text-sm">EJScreen demographics</h4>
              <dl className="mt-2 grid gap-1.5 text-sm">
                {ej.demographic.map((d) => (
                  <div key={d.code} className="flex justify-between gap-3">
                    <dt className="text-muted">{d.label}</dt>
                    <dd className="tabular-nums">
                      {d.percent}%{d.usPercentile !== null ? <span className="text-muted"> · {ordinal(d.usPercentile)}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-xs text-muted">
        Sources: {" "}
        <a className="underline underline-offset-4" href={TOOLS.svi.url}>
          CDC/ATSDR SVI 2022
        </a>{" "}
        (ACS 2018–2022, tract rankings) and{" "}
        <a className="underline underline-offset-4" href={TOOLS.ejscreen.url}>
          EJScreen v2.2 via the EJAM API
        </a>
        {ej?.reportUrl ? (
          <>
            {" "}
            ·{" "}
            <a className="underline underline-offset-4" href={ej.reportUrl}>
              full EJScreen community report
            </a>
          </>
        ) : data.located ? (
          <>
            {" "}
            ·{" "}
            <a className="underline underline-offset-4" href={ejscreenMapUrl(data.lat!, data.lon!)}>
              open EJScreen at this point
            </a>
          </>
        ) : null}
        . Percentiles describe the neighborhood, not a person. They tell you who to call first, not what the air is doing today.
      </p>
    </section>
  );
}
