import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SetupCard, btnGhost, btnPrimary } from "@/components/platform-ui";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { createStations, listMyStations, savePlan } from "@/lib/platform/api";
import { metricsForMeasures } from "@/lib/platform/metrics";
import type { StationRow } from "@/lib/platform/service.server";
import type { DraftPlan } from "@/lib/wizard/plan";
import { useDraft } from "@/lib/wizard/store";
import { hasLocation } from "@/lib/wizard/types";

const PLAN_KEY = "openiotwx-plan-id";

const readPlanId = () => {
  try {
    return window.localStorage.getItem(PLAN_KEY);
  } catch {
    return null;
  }
};

/** The step that turns a draft into a working system: save the plan, register its stations, get keys. */
export function PlanPublish({ plan }: { plan: DraftPlan }) {
  const { user, isPending } = useCurrentUserState();
  const answers = useDraft((s) => s.answers);
  const [planId, setPlanId] = useState<string | null>(null);
  const [mine, setMine] = useState<StationRow[]>([]);
  const [fresh, setFresh] = useState<{ station: { name: string; expected_metrics: string[] }; apiKey: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [ncar, setNcar] = useState(false);
  const place = hasLocation(answers.location) ? answers.location : null;

  const metrics = metricsForMeasures(answers.measures);
  const count = plan.stationCount;
  const perDay = count * metrics.length * 1440;
  const attached = planId ? mine.filter((s) => s.plan_id === planId) : [];
  const remaining = Math.max(0, count - attached.length);

  useEffect(() => {
    if (!user) return;
    setPlanId(readPlanId());
    listMyStations().then(setMine).catch(() => undefined);
  }, [user]);

  async function save(): Promise<string | null> {
    const s = useDraft.getState();
    try {
      const id = await savePlan({
        data: {
          id: planId ?? undefined,
          name: plan.siteName,
          configId: plan.recommendation?.configId ?? null,
          stationCount: count,
          data: {
            answers: s.answers,
            step: s.step,
            checks: {},
            goals: s.goals,
            goalLog: s.goalLog,
            goalsTouched: s.goalsTouched,
            siteName: s.siteName,
            startedAt: s.startedAt,
          },
        },
      });
      setPlanId(id);
      try {
        window.localStorage.setItem(PLAN_KEY, id);
      } catch {
        /* storage unavailable — the plan is still saved */
      }
      return id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the plan");
      return null;
    }
  }

  async function register() {
    setBusy(true);
    const id = await save();
    if (id) {
      try {
        const start = attached.length;
        const made = await createStations({
          data: {
            stations: Array.from({ length: remaining }, (_, i) => ({
              name: count === 1 ? plan.siteName : `${plan.siteName} ${start + i + 1}`,
              planId: id,
              configId: plan.recommendation?.configId ?? null,
              link: answers.link,
              expectedMetrics: metrics,
              ...(place ? { latitude: place.lat, longitude: place.lon } : {}),
              ncarNetwork: ncar && Boolean(place),
            })),
          },
        });
        setFresh(made);
        setMine(await listMyStations());
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not register the stations");
      }
    }
    setBusy(false);
  }

  return (
    <section className="no-print mt-8 rounded-2xl border border-kelp bg-card p-5">
      <p className="text-sm text-kelp-deep">Make it real</p>
      <h2 className="mt-1 font-display text-2xl">Save this plan and bring {count === 1 ? "the station" : "the stations"} online</h2>
      <p className="mt-2 text-sm text-muted">
        We register {count} station{count === 1 ? "" : "s"} for you, each with its own key. That is about{" "}
        {new Intl.NumberFormat().format(perDay)} readings a day at one reading a minute, which the platform handles on a
        small server.
      </p>

      {isPending ? null : !user ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link to="/login" search={{ next: "/plan" }} className={`${btnPrimary} btn-glow`}>
            Sign in or create an account
          </Link>
          <span className="text-sm text-muted">Your plan stays on this device until you do.</span>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className={btnGhost} disabled={busy} onClick={async () => (await save()) && toast.success("Plan saved to your account")}>
            {planId ? "Update saved plan" : "Save plan"}
          </button>
          {remaining > 0 ? (
            <label className="flex basis-full items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={ncar && Boolean(place)} disabled={!place} onChange={(e) => setNcar(e.target.checked)} />
              <span>
                Join the NCAR research network. Readings and position are shared openly and appear on the network map.
                {place ? " You can leave later." : " Choose a location in the plan first."}
              </span>
            </label>
          ) : null}
          {remaining > 0 ? (
            <button className={btnPrimary} disabled={busy} onClick={register}>
              {busy ? "Working…" : `Register ${remaining} station${remaining === 1 ? "" : "s"}`}
            </button>
          ) : attached.length ? (
            <Link to="/account" className={btnPrimary}>
              Go to my stations
            </Link>
          ) : null}
        </div>
      )}

      {fresh.length ? (
        <div className="mt-5 grid gap-3">
          {fresh.map((f) => (
            <SetupCard key={f.apiKey} station={f.station} apiKey={f.apiKey} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
