import { Link } from "@tanstack/react-router";
import { buildPlan, flashHref, needsRaspberryPi } from "@/lib/wizard/plan";
import { useDraft } from "@/lib/wizard/store";
import { cn } from "@/lib/utils";

export type FlowStep = 1 | 2 | 3 | 4 | "pi";

/**
 * The four stages from a plan to a working station, shown on every page that is
 * part of them (the flasher shows the same bar):
 *   1 Configure  →  2 Flash  →  3 Deploy and Publish  →  4 Track and Forecast
 *
 * Radio (LoRa) plans also get a Raspberry Pi gateway step between 2 and 3.
 */
export function FlowSteps({ current, station }: { current: FlowStep; station?: string }) {
  const answers = useDraft((s) => s.answers);
  const siteName = useDraft((s) => s.siteName);
  const plan = buildPlan(answers, siteName);
  const configure = flashHref(plan) ?? "/flash-wizard/index.html";
  const pi = needsRaspberryPi(plan);
  const search = { station };
  const items: { n: FlowStep; label: string; render: (cls: string, children: React.ReactNode) => React.ReactNode }[] = [
    { n: 1, label: "Configure", render: (cls, c) => <a href={configure} className={cls}>{c}</a> },
    { n: 2, label: "Flash", render: (cls, c) => <Link to="/flash" className={cls}>{c}</Link> },
    ...(pi
      ? [{ n: "pi" as const, label: "Raspberry Pi gateway", render: (cls: string, c: React.ReactNode) => <Link to="/raspberry-pi" className={cls}>{c}</Link> }]
      : []),
    { n: 3, label: "Deploy and Publish", render: (cls, c) => <Link to="/deploy" search={search} className={cls}>{c}</Link> },
    { n: 4, label: "Track and Forecast", render: (cls, c) => <Link to="/track" search={search} className={cls}>{c}</Link> },
  ];
  return (
    <nav aria-label="Setup steps" className="no-print mb-8">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {items.map((it, i) => {
          const active = it.n === current;
          const cls = cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm", active ? "bg-kelp text-paper" : "border border-line bg-card text-ink hover:border-kelp");
          return (
            <li key={it.n} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
              {it.render(
                cls,
                <>
                  <span className={cn("grid size-5 place-items-center rounded-full text-xs", active ? "bg-paper text-kelp" : "bg-moss text-kelp-deep")}>{it.n === "pi" ? "π" : it.n}</span>
                  {it.label}
                </>,
              )}
              {i < items.length - 1 ? <span className="hidden h-px w-5 bg-line sm:block" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
