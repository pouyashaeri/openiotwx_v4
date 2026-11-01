import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Notice, ParamPicker, RequireUser, SetupCard, StationCard, btnGhost, btnPrimary } from "@/components/platform-ui";
import { createStations, getMe, listMyStations, listPlans, listVariables, loadPlan, removePlan } from "@/lib/platform/api";
import { ago, useAsync } from "@/lib/platform/hooks";
import { useDraft, type Persisted } from "@/lib/wizard/store";
import { confirmDialog } from "@/components/confirm-dialog";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "My system | OpenIoTwx" }] }),
  component: () => (
    <RequireUser>
      <Account />
    </RequireUser>
  ),
});

function Account() {
  const navigate = useNavigate();
  const me = useAsync(() => getMe(), []);
  const plans = useAsync(() => listPlans(), []);
  const stations = useAsync(() => listMyStations(), [], 15000);
  const [fresh, setFresh] = useState<{ station: { name: string; expected_metrics: string[] }; apiKey: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [vars, setVars] = useState<{ shortname: string; name: string; units: string; category: string }[]>([]);
  const [metrics, setMetrics] = useState<string[]>([]);
  const loadVars = () => void listVariables().then(setVars).catch(() => undefined);
  useEffect(loadVars, []);

  async function open(id: string) {
    const plan = await loadPlan({ data: { id } });
    if (!plan) return toast.error("That plan is gone.");
    useDraft.getState().loadShared(plan.data as Persisted);
    void navigate({ to: "/plan" });
  }

  async function addStation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    try {
      setFresh(await createStations({ data: { stations: [{ name, expectedMetrics: metrics }] } }));
      form.reset();
      setMetrics([]);
      void stations.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the station");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-sm text-kelp-deep">My system</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl">{me.data?.name || "Your account"}</h1>
        {me.data && me.data.role !== "user" ? (
          <Link to="/admin" className={btnPrimary}>
            Admin panel
          </Link>
        ) : null}
      </div>
      {me.error ? <div className="mt-4"><Notice>{me.error}</Notice></div> : null}

      {fresh.length ? (
        <section className="mt-6 grid gap-3">
          {fresh.map((f) => (
            <SetupCard key={f.apiKey} station={f.station} apiKey={f.apiKey} />
          ))}
        </section>
      ) : null}

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl">My stations</h2>
          <div className="flex flex-wrap gap-2">
            <Link to="/chords" className={btnGhost}>
              Import from CHORDS
            </Link>
          </div>
        </div>
        <details className="mt-4 rounded-2xl border border-line bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium transition-colors duration-150 hover:text-kelp">Add a station by hand</summary>
          <form onSubmit={addStation} className="mt-3 grid gap-4">
            <input
              name="name"
              required
              maxLength={80}
              placeholder="Station name"
              aria-label="New station name"
              className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm"
            />
            <div>
              <p className="mb-2 text-sm text-muted">What will it measure? You can change this later.</p>
              <ParamPicker variables={vars} selected={metrics} onChange={setMetrics} onCatalogChange={loadVars} />
            </div>
            <button className={`${btnPrimary} justify-self-start`} disabled={busy}>
              Add station
            </button>
          </form>
        </details>
        {stations.error ? <div className="mt-3"><Notice>{stations.error}</Notice></div> : null}
        {stations.data?.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {stations.data.map((s) => (
              <StationCard key={s.id} station={s} />
            ))}
          </div>
        ) : stations.loading ? (
          <p className="mt-4 text-muted">Loading…</p>
        ) : (
          <p className="mt-4 text-muted">
            No stations yet. Finish the{" "}
            <Link to="/wizard" className="text-kelp underline underline-offset-4">
              wizard
            </Link>{" "}
            and register them from your plan, or add one above.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-2xl">My saved plans</h2>
        {plans.data?.length ? (
          <ul className="mt-4 grid gap-2">
            {plans.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-3">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-muted">
                    Configuration {p.config_id ?? "—"} · {p.station_count} station{p.station_count === 1 ? "" : "s"} · saved {ago(p.updated_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className={btnPrimary} onClick={() => void open(p.id)}>
                    Open
                  </button>
                  <button
                    className={btnGhost}
                    onClick={async () => {
                      if (!(await confirmDialog({ title: "Delete this plan?", message: `"${p.name}" will be deleted. Its stations are kept.`, confirmLabel: "Delete plan", danger: true }))) return;
                      await removePlan({ data: { id: p.id } });
                      void plans.reload();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-muted">
            Nothing saved yet. Save a plan from its page and it will be here on any device.
          </p>
        )}
      </section>
    </main>
  );
}
