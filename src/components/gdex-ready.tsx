import { Link } from "@tanstack/react-router";
import { cfFor } from "@/lib/gdex/cf";
import { metricsForMeasures } from "@/lib/platform/metrics";
import { useDraft } from "@/lib/wizard/store";
import { hasLocation, type StepId } from "@/lib/wizard/types";
import { cn } from "@/lib/utils";

/**
 * What the plan means for GDEX, worked out from the choices already made: which of the planned
 * variables become GDEX-ready data (with the CF names and units they will carry), and what is still
 * missing. It is how the wizard shows a community that the path to the archive starts here.
 */
export function GdexReady() {
  const answers = useDraft((s) => s.answers);
  const setStep = useDraft((s) => s.setStep);
  const metrics = metricsForMeasures(answers.measures);
  const vars = metrics.map((m) => ({ key: m, ...cfFor(m) }));
  const placed = hasLocation(answers.location);
  const shares = answers.sharing === "community" || answers.sharing === "open";

  const checks: { ok: boolean; label: string; hint: string; step?: StepId }[] = [
    { ok: vars.length > 0, label: "Measurements chosen", hint: "Choose what the stations measure in the wizard.", step: "measures" },
    { ok: placed, label: "A location for the stations", hint: "GDEX needs coordinates on every station. Set the place in the wizard.", step: "place" },
    { ok: shares, label: "A sharing level that lets stations join the NCAR network", hint: "Choose “Share with the community” or “Publish as open data” in the data step.", step: "data" },
    { ok: answers.gdex, label: "GDEX archiving switched on for this plan", hint: "Use the switch below. Each station's steward still gives consent when it is running." },
  ];
  const ready = checks.every((c) => c.ok);

  return (
    <div className="mt-4 rounded-lg border border-line bg-panel px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">What this plan gives GDEX</p>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs", ready ? "bg-moss text-kelp-deep" : "border border-line text-muted")}>
          {ready ? "On track for GDEX" : `${checks.filter((c) => !c.ok).length} to settle`}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Once the stations are running and in the NCAR network, every release writes these measurements with coordinates, numeric UTC time, and the names and units below, as CF-compliant NetCDF.
      </p>

      <ul className="mt-3 grid gap-1.5 text-sm">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-2">
            <span aria-hidden="true" className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs", c.ok ? "bg-moss text-kelp-deep" : "border border-line text-muted")}>
              {c.ok ? "✓" : "·"}
            </span>
            <span>
              {c.label}
              {!c.ok ? (
                <span className="block text-xs text-muted">
                  {c.hint}
                  {c.step ? (
                    <>
                      {" "}
                      <Link to="/wizard" className="underline underline-offset-4" onClick={() => setStep(c.step as StepId)}>
                        Open that step
                      </Link>
                    </>
                  ) : null}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {vars.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">Measurement</th>
                <th className="py-1 pr-3 font-normal">CF standard name</th>
                <th className="py-1 font-normal">Units</th>
              </tr>
            </thead>
            <tbody>
              {vars.map((v) => (
                <tr key={v.key} className="border-t border-line">
                  <td className="py-1 pr-3">{v.longName}</td>
                  <td className="py-1 pr-3 font-mono">{v.standardName ?? "(described by name only)"}</td>
                  <td className="py-1 font-mono">{v.units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="no-print mt-3 text-xs text-muted">
        <Link to="/gdex" className="underline underline-offset-4">
          How the road from a station to GDEX works
        </Link>
      </p>
    </div>
  );
}
