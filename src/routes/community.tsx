import { createFileRoute, Link } from "@tanstack/react-router";
import { Copy, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConnectionsPanel } from "@/components/connections-panel";
import { OFFERS, PARTS, gramsFor, hoursFor, partsFor, type OfferId } from "@/lib/collective/parts";
import { useCollective, type PrintStatus, type QueueRow } from "@/lib/collective/store";
import { api, type ComputeStatus } from "@/lib/connect/api";
import { useConnections } from "@/lib/connect/settings";
import { DOCS, SHARING, TOOLS } from "@/lib/wizard/catalog";
import { useDraft } from "@/lib/wizard/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/community")({
  head: () => ({ meta: [{ title: "Community — OpenIoTwx" }] }),
  component: CommunityPage,
});

const STATUSES: Array<{ id: PrintStatus; label: string }> = [
  { id: "queued", label: "Queued" },
  { id: "printing", label: "Printing" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed, reprint" },
];

function CommunityPage() {
  const hydrated = useDraft((state) => state.hydrated);
  const hydrate = useDraft((state) => state.hydrate);
  const answers = useDraft((state) => state.answers);
  const siteName = useDraft((state) => state.siteName);
  const collective = useCollective();
  const connections = useConnections();
  const [compute, setCompute] = useState<ComputeStatus[]>([]);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<OfferId | "all">("all");

  useEffect(() => {
    hydrate();
    collective.hydrate();
    connections.hydrate();
  }, [hydrate, collective, connections]);

  const parts = useMemo(() => partsFor(answers), [answers]);
  const stationCount = answers.count ?? 1;
  const stationLabels = useMemo(
    () => Array.from({ length: stationCount }, (_, i) => `${siteName || "Station"}${stationCount > 1 ? ` ${i + 1}` : ""}`),
    [siteName, stationCount],
  );

  // Seed the queue from the plan: one row per part per station. Statuses already set survive.
  useEffect(() => {
    if (!hydrated || !collective.hydrated || !answers.intent) return;
    const rows: QueueRow[] = stationLabels.flatMap((station) =>
      parts.map((part) => ({ station, part: part.id, status: "queued" as const, owner: "" })),
    );
    collective.seed(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, collective.hydrated, answers.intent, stationLabels.join("|"), parts.map((p) => p.id).join("|")]);

  // Pull the offers board and compute pool from the community server when it answers.
  useEffect(() => {
    if (!connections.hydrated) return;
    let cancelled = false;
    void Promise.all([api.collective(connections.apiUrl), api.compute(connections.apiUrl)]).then(([members, pool]) => {
      if (cancelled) return;
      setServerOk(members.ok);
      if (members.ok) {
        collective.mergeServerOffers(
          members.data.map((m) => ({
            id: `server-${m.id}`,
            name: m.name,
            contact: m.contact,
            area: m.area,
            offers: m.offers,
            printers: m.printers,
            notes: m.notes,
            createdAt: m.created_at,
            synced: true,
          })),
        );
      }
      setCompute(pool.ok ? pool.data : []);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections.hydrated, connections.apiUrl]);

  if (!hydrated || !collective.hydrated) {
    return <p className="mx-auto max-w-5xl px-4 py-16 text-muted">Opening your draft…</p>;
  }

  const queue = collective.queue.filter((row) => stationLabels.includes(row.station) && parts.some((p) => p.id === row.part));
  const doneRows = queue.filter((r) => r.status === "done");
  const totalHours = hoursFor(parts) * stationCount;
  const doneHours = doneRows.reduce((sum, row) => sum + (PARTS.find((p) => p.id === row.part)?.hours ?? 0), 0);
  const grams = gramsFor(parts) * stationCount;
  const visibleOffers = collective.offers.filter((o) => filter === "all" || o.offers.includes(filter));

  async function syncQueue() {
    const result = await api.saveInventory(
      connections.apiUrl,
      queue.map((row) => ({ station_label: row.station, part_id: row.part, status: row.status, owner: row.owner })),
    );
    if (result.ok) toast.success("Print queue saved on the community server");
    else toast.error(`Could not save: ${result.error}`);
  }

  async function copyQueue() {
    const lines = [
      `OpenIoTwx print queue for ${siteName || "the plan"}`,
      `${stationCount} station${stationCount === 1 ? "" : "s"} · ${totalHours} print hours · about ${grams} g of filament`,
      ``,
      ...stationLabels.flatMap((station) => [
        station,
        ...queue
          .filter((r) => r.station === station)
          .map((r) => {
            const part = PARTS.find((p) => p.id === r.part);
            return `  [${r.status === "done" ? "x" : " "}] ${part?.name ?? r.part} (${part?.hours ?? "?"} h)${r.owner ? ` — ${r.owner}` : ""}`;
          }),
        ``,
      ]),
      `STL files: ${DOCS.stl}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Queue copied");
    } catch {
      toast.error("Copy failed in this browser.");
    }
  }

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="eyebrow">Community</p>
      <h1 className="mt-2 text-4xl sm:text-5xl">Build it together. Run it together.</h1>
      <p className="mt-3 max-w-2xl text-muted">
        A station is a few hours of printing and a Saturday of clicking parts together. The build collective keeps the
        print queue and connects you with neighbors who have a printer, spare parts, or an idle computer to lend to
        the forecast.
      </p>

      {!answers.intent ? (
        <p className="no-print mt-4 rounded-lg border border-line bg-brand-soft px-4 py-3 text-sm">
          The queue fills from your plan.{" "}
          <Link to="/wizard" className="text-brand-deep underline underline-offset-4">
            Start the wizard
          </Link>{" "}
          to see the parts for your station.
        </p>
      ) : null}

      <section id="collective" className="mt-8 scroll-mt-20" aria-labelledby="queue-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Build collective</p>
            <h2 id="queue-title" className="mt-1 text-2xl">
              Print queue
            </h2>
            <p className="mt-1 text-sm text-muted">
              {parts.length} parts per station · {stationCount} station{stationCount === 1 ? "" : "s"} · {totalHours} h total, {doneHours} h done · about {grams} g of filament
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-2">
            <button type="button" onClick={copyQueue} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-sm">
              <Copy className="size-4" aria-hidden="true" />
              Copy queue
            </button>
            <button
              type="button"
              onClick={syncQueue}
              disabled={serverOk === false}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-brand px-3 text-sm text-surface disabled:opacity-50"
            >
              Save to community server
            </button>
            <a href={DOCS.stl} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-sm">
              <Printer className="size-4" aria-hidden="true" />
              STL files
            </a>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-md bg-surface-2" role="meter" aria-valuenow={doneHours} aria-valuemin={0} aria-valuemax={totalHours} aria-label="Print hours finished">
          <div className="h-1.5 rounded-md bg-brand" style={{ width: `${totalHours ? (doneHours / totalHours) * 100 : 0}%` }} />
        </div>

        <div className="mt-4 grid gap-4">
          {stationLabels.map((station) => (
            <div key={station} className="overflow-hidden rounded-lg border border-line bg-panel">
              <p className="border-b border-line bg-surface-2 px-4 py-2 font-medium">{station}</p>
              <ul>
                {parts.map((part) => {
                  const row = queue.find((r) => r.station === station && r.part === part.id) ?? { station, part: part.id, status: "queued" as const, owner: "" };
                  return (
                    <li key={part.id} className="grid gap-2 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_11rem_12rem] sm:items-center">
                      <div>
                        <p className="flex flex-wrap items-center gap-2">
                          <span>{part.name}</span>
                          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">{part.group}</span>
                          <span className="text-xs tabular-nums text-muted">
                            {part.hours} h · {part.grams} g
                          </span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted">{part.tip}</p>
                      </div>
                      <label className="text-sm">
                        <span className="sr-only">Status for {part.name}</span>
                        <select
                          value={row.status}
                          onChange={(event) => collective.setStatus(station, part.id, event.target.value as PrintStatus)}
                          className={cn(
                            "w-full rounded-md border px-2 py-2 text-sm",
                            row.status === "done" ? "border-brand bg-brand-soft" : row.status === "failed" ? "border-warn" : "border-line bg-surface",
                          )}
                        >
                          {STATUSES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        <span className="sr-only">Who prints {part.name}</span>
                        <input
                          value={row.owner}
                          onChange={(event) => collective.setOwner(station, part.id, event.target.value)}
                          placeholder="Who is printing it"
                          className="w-full rounded-md border border-line bg-surface px-2 py-2 text-sm"
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Hours match the plan's print estimate. Print the core orb first; it is the long one. PETG or ASA outdoors. The
          queue is kept on this device until you save it to the community server.
        </p>
      </section>

      <JoinSection serverOk={serverOk} />

      <section className="mt-10" aria-labelledby="board-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="board-title" className="text-2xl">
              Who is offering what
            </h2>
            <p className="mt-1 text-sm text-muted">
              {serverOk ? "From your community server, plus anything added on this device." : serverOk === false ? "The community server is not reachable; showing what was added on this device." : "Loading…"}
            </p>
          </div>
          <div className="no-print flex flex-wrap gap-1">
            {(["all", ...OFFERS.map((o) => o.id)] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={cn("min-h-9 rounded-md border px-3 text-sm", filter === id ? "border-brand bg-brand-soft" : "border-line bg-panel")}
              >
                {id === "all" ? "All" : OFFERS.find((o) => o.id === id)?.label}
              </button>
            ))}
          </div>
        </div>
        {visibleOffers.length ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {visibleOffers.map((o) => (
              <li key={o.id} className="rounded-lg border border-line bg-panel px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{o.name}</p>
                  <p className="text-xs text-muted">{o.synced ? "on the server" : "this device only"}</p>
                </div>
                <p className="text-sm text-muted">{o.area}</p>
                <p className="mt-2 flex flex-wrap gap-1">
                  {o.offers.map((id) => (
                    <span key={id} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs">
                      {OFFERS.find((x) => x.id === id)?.label ?? id}
                    </span>
                  ))}
                </p>
                {o.printers ? <p className="mt-2 text-sm">{o.printers}</p> : null}
                {o.notes ? <p className="mt-1 text-sm text-muted">{o.notes}</p> : null}
                {o.contact ? <p className="mt-2 font-mono text-xs text-brand-deep">{o.contact}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted">
            Nobody has posted yet. The first offer is usually the printer that printed the first station.
          </p>
        )}
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-2" aria-labelledby="pool-title">
        <div className="rounded-lg border border-line bg-panel px-4 py-4">
          <h2 id="pool-title" className="text-xl">
            Compute pool
          </h2>
          <p className="mt-1 text-sm text-muted">
            {TOOLS.boinc.what} The steward runs the small {TOOLS.boinc.name} project server from <code>infra/boinc</code>; volunteers attach with the address and account key below.
          </p>
          {compute.length ? (
            <ul className="mt-3 grid gap-2 text-sm">
              {compute.map((c) => (
                <li key={c.backend} className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", c.available ? "bg-brand" : "bg-line")} aria-hidden="true" />
                  <span className="capitalize">{c.backend}</span>
                  <span className="text-muted">
                    · {c.detail}
                    {c.volunteers !== undefined ? ` · ${c.volunteers} volunteers` : ""}
                    {c.queued !== undefined ? ` · ${c.queued} queued` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">Pool status appears when the community server answers.</p>
          )}
          <p className="mt-3 text-sm">
            <Link to="/forecast" className="text-brand-deep underline underline-offset-4">
              Request a forecast on the pool
            </Link>
          </p>
        </div>
        <div className="rounded-lg border border-line bg-panel px-4 py-4">
          <h2 className="text-xl">What this community shares</h2>
          <p className="mt-1 text-sm text-muted">Decided in the wizard's data step, recorded on the plan.</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="text-muted">Readings</dt>
              <dd>{answers.sharing ? SHARING.find((s) => s.id === answers.sharing)?.title : "Not decided yet"}</dd>
            </div>
            <div>
              <dt className="text-muted">GDEX archive</dt>
              <dd>{answers.gdex ? "Opted in. Consent and the dataset preview are on the plan." : "Off. One switch on the plan turns it on."}</dd>
            </div>
            <div>
              <dt className="text-muted">Build queue and offers</dt>
              <dd>Kept on this device until saved to the community server. Contact details stay inside that server.</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm">
            <Link to="/plan" className="text-brand-deep underline underline-offset-4">
              Open the plan's data section
            </Link>
          </p>
        </div>
      </section>

      <ConnectionsPanel className="mt-8" />
    </main>
  );
}

function JoinSection({ serverOk }: { serverOk: boolean | null }) {
  const answers = useDraft((state) => state.answers);
  const collective = useCollective();
  const connections = useConnections();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [area, setArea] = useState(answers.location.label);
  const [printers, setPrinters] = useState("");
  const [notes, setNotes] = useState("");
  const [offers, setOffers] = useState<OfferId[]>(() =>
    OFFERS.map((o) => o.id).filter((id) => (answers.resources as string[]).includes(id)),
  );
  const [saving, setSaving] = useState(false);

  function toggle(id: OfferId) {
    setOffers((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  async function join() {
    if (!name.trim()) {
      toast.error("Add a name people will recognize.");
      return;
    }
    if (!offers.length) {
      toast.error("Pick at least one thing you can offer.");
      return;
    }
    const row = collective.addOffer({ name: name.trim(), contact: contact.trim(), area: area.trim(), offers, printers: printers.trim(), notes: notes.trim() });
    setSaving(true);
    const result = await api.join(connections.apiUrl, { name: row.name, contact: row.contact, area: row.area, offers: row.offers, printers: row.printers, notes: row.notes });
    setSaving(false);
    if (result.ok) {
      collective.markSynced(row.id);
      toast.success("You are on the board");
    } else {
      toast("Saved on this device. The community server was not reachable, so others cannot see it yet.");
    }
    setName("");
    setNotes("");
  }

  return (
    <section className="mt-10" aria-labelledby="join-title">
      <h2 id="join-title" className="text-2xl">
        Join the collective
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Offer printer time, parts, hands, a computer, or a place to run the server. Your details go to your community's
        own server {serverOk === false ? "(not reachable right now, so they stay on this device)" : ""}, never to a public
        list.
      </p>
      <div className="mt-4 grid gap-3 rounded-lg border border-line bg-panel px-4 py-4 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={setName} placeholder="A person, a school, a library" />
        <Input label="How to reach you" value={contact} onChange={setContact} placeholder="Email, phone, or the group chat" />
        <Input label="Where" value={area} onChange={setArea} placeholder="Neighborhood or town" />
        <Input label="Printers (if any)" value={printers} onChange={setPrinters} placeholder="Prusa MK4, 250 mm bed, PETG ok" />
        <fieldset className="sm:col-span-2">
          <legend className="text-sm text-muted">What you can offer</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {OFFERS.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={offers.includes(o.id)}
                onClick={() => toggle(o.id)}
                className={cn("rounded-md border px-3 py-2 text-left text-sm", offers.includes(o.id) ? "border-brand bg-brand-soft" : "border-line bg-surface")}
              >
                <span className="block">{o.label}</span>
                <span className="block text-xs text-muted">{o.blurb}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm sm:col-span-2" htmlFor="join-notes">
          <span className="text-muted">Notes</span>
          <textarea
            id="join-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="Weekends only. Have two spare Atom Lites. Can host a Pi in the garage."
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
          />
        </label>
        <div className="sm:col-span-2">
          <button type="button" onClick={join} disabled={saving} className="min-h-11 rounded-md bg-brand px-5 text-sm font-medium text-surface disabled:opacity-50">
            {saving ? "Posting…" : "Post my offer"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const id = `join-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <label className="block text-sm" htmlFor={id}>
      <span className="text-muted">{label}</span>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
    </label>
  );
}
