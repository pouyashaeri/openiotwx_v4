import { useId } from "react";
import { ordinal } from "@/lib/place/format";
import { cn } from "@/lib/utils";

type Point = { t: string; v: number };

type LineChartProps = {
  label: string;
  unit: string;
  history: Point[];
  forecast: Point[];
  /** Horizontal reference lines, drawn in the warn color with a small label. */
  lines?: Array<{ at: number; label: string }>;
  height?: number;
  className?: string;
};

const W = 640;

function extent(points: Point[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    if (p.v < lo) lo = p.v;
    if (p.v > hi) hi = p.v;
  }
  return [lo, hi];
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

/**
 * One variable through time: what the station recorded (solid), what the model expects
 * (dashed), and a vertical mark at now. Everything is drawn in the page's own tokens so the
 * chart reads as part of the plan, not an embedded widget.
 */
export function LineChart({ label, unit, history, forecast, lines = [], height = 180, className }: LineChartProps) {
  const id = useId();
  const all = [...history, ...forecast];
  if (all.length < 2) {
    return (
      <div className={cn("rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted", className)}>
        {label}: no readings yet.
      </div>
    );
  }
  const padL = 44;
  const padR = 12;
  const padT = 18;
  const padB = 24;
  const t0 = new Date(all[0]!.t).getTime();
  const t1 = new Date(all[all.length - 1]!.t).getTime();
  const [lo0, hi0] = extent(all);
  const lineVals = lines.map((l) => l.at).filter((v) => v > lo0 - (hi0 - lo0) && v < hi0 + (hi0 - lo0));
  const lo = Math.min(lo0, ...lineVals);
  const hi = Math.max(hi0, ...lineVals);
  const span = hi - lo || 1;
  const x = (t: string) => padL + ((new Date(t).getTime() - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (height - padT - padB);
  const path = (points: Point[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const nowT = history.length ? history[history.length - 1]!.t : forecast[0]!.t;
  const nowX = x(nowT);
  const bridge = history.length && forecast.length ? [history[history.length - 1]!, forecast[0]!] : [];
  // day ticks
  const ticks: Array<{ x: number; label: string }> = [];
  const first = new Date(t0);
  first.setHours(0, 0, 0, 0);
  for (let d = first.getTime() + 86400_000; d < t1; d += 86400_000) {
    ticks.push({ x: x(new Date(d).toISOString()), label: dayLabel(new Date(d).toISOString()) });
  }
  const last = all[all.length - 1]!;
  const nowV = history.length ? history[history.length - 1]!.v : null;

  return (
    <figure className={cn("rounded-lg border border-line bg-panel px-3 pb-2 pt-3", className)}>
      <figcaption className="flex items-baseline justify-between gap-3 px-1 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">
          {nowV !== null ? `${nowV} ${unit} now` : ""}
          {forecast.length ? ` · ${last.v} ${unit} by ${dayLabel(last.t)}` : ""}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} className="mt-1 h-auto w-full" role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{`${label} in ${unit}: recorded readings and forecast`}</title>
        <defs>
          <pattern id={`${id}-f`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="var(--color-surface-2)" />
          </pattern>
        </defs>
        {forecast.length ? (
          <rect x={nowX} y={padT} width={W - padR - nowX} height={height - padT - padB} fill={`url(#${id}-f)`} opacity="0.7" />
        ) : null}
        {[0, 0.5, 1].map((f) => {
          const v = lo + span * f;
          return (
            <g key={f}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)" className="tabular-nums">
                {Number.isInteger(v) ? v : v.toFixed(1)}
              </text>
            </g>
          );
        })}
        {ticks.map((tick) => (
          <g key={tick.x}>
            <line x1={tick.x} x2={tick.x} y1={padT} y2={height - padB} stroke="var(--color-line)" strokeDasharray="2 4" />
            <text x={tick.x + 3} y={height - 8} fontSize="11" fill="var(--color-muted)">
              {tick.label}
            </text>
          </g>
        ))}
        {lines.map((l) => (
          <g key={l.label}>
            <line x1={padL} x2={W - padR} y1={y(l.at)} y2={y(l.at)} stroke="var(--color-warn)" strokeWidth="1" strokeDasharray="5 3" />
            <text x={W - padR} y={y(l.at) - 3} textAnchor="end" fontSize="10" fill="var(--color-warn)">
              {l.label}
            </text>
          </g>
        ))}
        {history.length > 1 ? <path d={path(history)} fill="none" stroke="var(--color-brand)" strokeWidth="2" /> : null}
        {bridge.length === 2 ? <path d={path(bridge)} fill="none" stroke="var(--color-brand-deep)" strokeWidth="2" strokeDasharray="4 4" /> : null}
        {forecast.length > 1 ? <path d={path(forecast)} fill="none" stroke="var(--color-brand-deep)" strokeWidth="2" strokeDasharray="4 4" /> : null}
        <line x1={nowX} x2={nowX} y1={padT - 4} y2={height - padB} stroke="var(--color-ink)" strokeWidth="1.2" />
        <text x={nowX + 4} y={padT - 6} fontSize="10" fill="var(--color-ink)">
          now
        </text>
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-4 px-1 text-xs text-muted">
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-brand align-middle" aria-hidden="true" />
          recorded
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-brand-deep align-middle" aria-hidden="true" />
          forecast
        </span>
        {lines.length ? (
          <span>
            <span className="mr-1 inline-block h-0.5 w-4 border-t border-dashed border-warn align-middle" aria-hidden="true" />
            threshold
          </span>
        ) : null}
      </p>
    </figure>
  );
}

/** A percentile from 0 to 1 (or 0 to 100), as a bar with the band it falls in. */
export function RankBar({
  label,
  value,
  detail,
  scale = 1,
  flagged,
}: {
  label: string;
  value: number | null;
  detail?: string;
  scale?: 1 | 100;
  flagged?: boolean;
}) {
  const fraction = value === null ? 0 : Math.max(0, Math.min(1, value / scale));
  const high = fraction > 0.75;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          {label}
          {flagged ? (
            <span className="rounded-md border border-warn px-1.5 py-px text-[11px] text-warn">top 10%</span>
          ) : null}
        </span>
        <span className="tabular-nums text-muted">{value === null ? "—" : ordinal(fraction * 100)}</span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-md bg-surface-2"
        role="meter"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={cn("h-1.5 rounded-md", high ? "bg-warn" : "bg-brand")} style={{ width: `${fraction * 100}%` }} />
      </div>
      {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
    </div>
  );
}
