import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ago, isOnline, useIsWindows } from "@/lib/platform/hooks";
import { metricInfo } from "@/lib/platform/metrics";
import { ingestCommand, sampleValues, shellName } from "@/lib/platform/sample";
import type { SeriesPoint, StationRow } from "@/lib/platform/service.server";
import { cn } from "@/lib/utils";

// One simple hover family for every button: filled ones brighten, outlined ones take the brand border and a faint tint.
// `not-disabled:` keeps a disabled button still, and also works on links. (.btn-glow, where it is added, overrides this on purpose.)
export const btn = "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-medium transition-[filter,background-color,border-color] duration-150 disabled:opacity-60";
export const btnPrimary = `${btn} bg-kelp text-paper not-disabled:hover:brightness-110`;
export const btnGhost = `${btn} border border-line bg-card text-ink not-disabled:hover:border-kelp not-disabled:hover:bg-paper-deep`;

export function StatusDot({ station }: { station: Pick<StationRow, "status" | "last_seen_at"> }) {
  const state = station.status === "disabled" ? "disabled" : isOnline(station.last_seen_at) ? "online" : "quiet";
  const tone = { online: "bg-emerald-500", quiet: "bg-amber-500", disabled: "bg-neutral-400" }[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={cn("size-2 rounded-full", tone)} aria-hidden="true" />
      {state === "online" ? "Online" : state === "quiet" ? `Last heard ${ago(station.last_seen_at)}` : "Disabled"}
    </span>
  );
}

export function StationCard({ station }: { station: StationRow }) {
  const entries = Object.entries(station.last_values).slice(0, 4);
  return (
    <Link
      to="/stations/$slug"
      params={{ slug: station.slug }}
      className="block rounded-2xl border border-line bg-card p-4 transition hover:border-kelp"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{station.name}</p>
        <StatusDot station={station} />
      </div>
      {entries.length ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {entries.map(([k, x]) => {
            const m = metricInfo(k);
            return (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-muted">{m.label}</dt>
                <dd className="tabular-nums">
                  {Math.round(x.v * 100) / 100} {m.unit}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted">No data yet. Send a first reading to bring it online.</p>
      )}
    </Link>
  );
}

export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-3 min-w-0 max-w-full">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{label}</p>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-kelp transition-colors duration-150 hover:text-kelp-deep"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            } catch {
              toast.error("Copy failed in this browser.");
            }
          }}
        >
          {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-1 max-w-full whitespace-pre-wrap rounded-xl bg-navy [overflow-wrap:anywhere] p-3 font-mono text-xs leading-relaxed text-blue-100">{text}</pre>
    </div>
  );
}

/** Everything a person needs to bring one station online. Shown once, right after the key is minted. */
export function SetupCard({ station, apiKey }: { station: Pick<StationRow, "name" | "expected_metrics">; apiKey: string }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const windows = useIsWindows();
  const sample = sampleValues(station.expected_metrics.length ? station.expected_metrics : ["temp_c"]);
  const curl = ingestCommand({ origin, key: apiKey, values: sample, windows });
  const device = JSON.stringify({ server: origin, key: apiKey, interval_s: 60, metrics: Object.keys(sample) }, null, 2);
  return (
    <div className="min-w-0 rounded-2xl border border-copper bg-card p-4">
      <p className="font-medium">{station.name}</p>
      <p className="mt-1 text-sm text-copper">This key is shown once. Copy it into the station's settings now.</p>
      <CopyBlock label="API key" text={apiKey} />
      <CopyBlock label="Station settings (config.json)" text={device} />
      <CopyBlock label={`Send one reading (${shellName(windows)}, any computer or board)`} text={curl} />
    </div>
  );
}

/** Line chart with a min/max band, plain SVG so it ships no chart dependency. */
export function TimeChart({
  points,
  unit,
  label,
  forecast = [],
  forecastLabel = "Forecast",
}: {
  points: SeriesPoint[];
  unit: string;
  label: string;
  forecast?: { t: string; avg: number }[];
  forecastLabel?: string;
}) {
  if (points.length < 2) {
    return (
      <div className="grid h-48 place-items-center rounded-2xl border border-line bg-card text-sm text-muted">
        Not enough data in this window yet.
      </div>
    );
  }
  const W = 640;
  const H = 200;
  const pad = { l: 8, r: 8, t: 12, b: 20 };
  const ts = points.map((p) => new Date(p.t).getTime());
  const t0 = ts[0];
  const fts = forecast.map((p) => new Date(p.t).getTime());
  const t1 = Math.max(ts[ts.length - 1] || t0 + 1, ...fts);
  const lo = Math.min(...points.map((p) => p.min), ...forecast.map((p) => p.avg));
  const hi = Math.max(...points.map((p) => p.max), ...forecast.map((p) => p.avg));
  const span = hi - lo || 1;
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / span) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(ts[i]).toFixed(1)} ${y(p.avg).toFixed(1)}`).join(" ");
  const band =
    points.map((p, i) => `${i ? "L" : "M"}${x(ts[i]).toFixed(1)} ${y(p.max).toFixed(1)}`).join(" ") +
    " " +
    [...points].reverse().map((p, i) => `L${x(ts[points.length - 1 - i]).toFixed(1)} ${y(p.min).toFixed(1)}`).join(" ") +
    " Z";
  // The forecast continues from the last observation so the two read as one line.
  const fline = forecast.length
    ? [{ t: ts[ts.length - 1], avg: points[points.length - 1].avg }, ...forecast.map((p, i) => ({ t: fts[i], avg: p.avg }))]
        .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.avg).toFixed(1)}`)
        .join(" ")
    : "";
  const fmt = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <figure className="rounded-2xl border border-line bg-card p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" role="img" aria-label={`${label}, ${Math.round(lo * 10) / 10} to ${Math.round(hi * 10) / 10} ${unit}`}>
        <path d={band} className="fill-kelp/10" />
        <path d={line} fill="none" strokeWidth="2" stroke="currentColor" className="text-kelp" />
        {fline ? <path d={fline} fill="none" strokeWidth="2" strokeDasharray="6 4" stroke="currentColor" className="text-copper" /> : null}
        <text x={pad.l} y={H - 4} className="fill-muted text-[10px]">
          {fmt(t0)}
        </text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="fill-muted text-[10px]">
          {fmt(t1)}
        </text>
      </svg>
      {forecast.length ? (
        <p className="mt-1 text-xs text-muted">
          Solid is what the station measured. Dashed is {forecastLabel.toLowerCase()}.
        </p>
      ) : null}
      <figcaption className="mt-1 flex justify-between text-xs text-muted tabular-nums">
        <span>
          min {Math.round(lo * 100) / 100} {unit}
        </span>
        <span>
          max {Math.round(hi * 100) / 100} {unit}
        </span>
      </figcaption>
    </figure>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl border border-copper bg-card px-3 py-2 text-sm">
      {children}
    </p>
  );
}

/** Renders children for signed-in visitors; sends everyone else to /login and back. */
export function RequireUser({ children }: { children: React.ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  // The whole address, so signing in brings the visitor back to exactly this view (query and all).
  const here = useRouterState({ select: (s) => s.location.href });
  const navigate = useNavigate();
  // Redirect once, and replace this page in the history so Back does not land on a sign-in loop.
  useEffect(() => {
    if (!isPending && !user) void navigate({ to: "/login", search: { next: here }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `here` is read when the redirect fires, not a trigger
  }, [isPending, user]);
  if (isPending || !user) return <p className="mx-auto max-w-5xl px-4 py-16 text-muted">{isPending ? "Checking your session…" : "Taking you to sign in…"}</p>;
  return <>{children}</>;
}

/**
 * Pick the variables a station reports: grouped checkboxes from the shared
 * catalog, plus a small form to add a variable that isn't in it yet.
 */
export function ParamPicker({
  variables,
  selected,
  onChange,
  onCatalogChange,
}: {
  variables: { shortname: string; name: string; units: string; category: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  onCatalogChange?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const groups = new Map<string, typeof variables>();
  for (const v of variables) groups.set(v.category, [...(groups.get(v.category) ?? []), v]);
  // A selected variable that left the catalog should still be visible and removable.
  const orphans = selected.filter((s) => !variables.some((v) => v.shortname === s));
  const toggle = (k: string) => onChange(selected.includes(k) ? selected.filter((s) => s !== k) : [...selected, k]);

  return (
    <div className="grid gap-4">
      {[...groups.entries()].map(([cat, list]) => (
        <fieldset key={cat}>
          <legend className="text-xs font-medium capitalize tracking-wide text-kelp-deep">{cat}</legend>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {list.map((v) => (
              <label key={v.shortname} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(v.shortname)} onChange={() => toggle(v.shortname)} className="size-4" />
                <span>
                  {v.name}
                  {v.units ? <span className="text-muted"> ({v.units})</span> : null}
                </span>
                <code className="ml-auto text-xs text-muted">{v.shortname}</code>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {orphans.length ? (
        <fieldset>
          <legend className="text-xs font-medium tracking-wide text-kelp-deep">Other</legend>
          {orphans.map((k) => (
            <label key={k} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked onChange={() => toggle(k)} className="size-4" />
              <code>{k}</code>
            </label>
          ))}
        </fieldset>
      ) : null}
      {adding ? (
        <NewVariable
          onDone={(added) => {
            setAdding(false);
            if (added) {
              onChange([...selected, added]);
              onCatalogChange?.();
            }
          }}
        />
      ) : (
        <button type="button" className="justify-self-start text-sm text-kelp underline underline-offset-4 transition-colors duration-150 hover:text-kelp-deep" onClick={() => setAdding(true)}>
          A variable that isn't listed? Add it
        </button>
      )}
    </div>
  );
}

function NewVariable({ onDone }: { onDone: (shortname: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-paper p-3 sm:grid-cols-4">
      {(["shortname", "name", "units", "category"] as const).map((f) => (
        <input
          key={f}
          id={`nv-${f}`}
          placeholder={{ shortname: "shortname (leaf_wetness)", name: "Name", units: "Units", category: "Group" }[f]}
          aria-label={f}
          className="min-h-10 rounded-lg border border-line bg-card px-3 text-sm"
        />
      ))}
      {err ? <p role="alert" className="text-sm text-copper sm:col-span-4">{err}</p> : null}
      <div className="flex gap-2 sm:col-span-4">
        <button
          type="button"
          disabled={busy}
          className={btnPrimary}
          onClick={async () => {
            const v = (f: string) => (document.getElementById(`nv-${f}`) as HTMLInputElement).value.trim();
            setBusy(true);
            setErr(null);
            try {
              const { addVariable } = await import("@/lib/platform/api");
              await addVariable({ data: { shortname: v("shortname").toLowerCase(), name: v("name"), units: v("units"), category: v("category") || "other" } });
              onDone(v("shortname").toLowerCase());
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Could not add it");
              setBusy(false);
            }
          }}
        >
          Add variable
        </button>
        <button type="button" className={btnGhost} onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
