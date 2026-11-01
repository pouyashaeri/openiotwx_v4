import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Notice, RequireUser, btnGhost, btnPrimary } from "@/components/platform-ui";
import { chordsBrowse, chordsImport } from "@/lib/platform/api";
import { PORTALS } from "@/lib/platform/chords-portals";

export const Route = createFileRoute("/chords")({
  head: () => ({ meta: [{ title: "Import from CHORDS — OpenIoTwx" }] }),
  component: () => (
    <RequireUser>
      <ChordsImport />
    </RequireUser>
  ),
});


type Browse = Awaited<ReturnType<typeof chordsBrowse>>;
type Inst = Browse["instruments"][number];

function ChordsImport() {
  const navigate = useNavigate();
  const [portal, setPortal] = useState<string>(PORTALS[0].url);
  const [data, setData] = useState<Browse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Inst | null>(null);
  const [filter, setFilter] = useState("");

  async function load(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setPick(null);
    try {
      setData(await chordsBrowse({ data: { portal } }));
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "Could not reach that portal");
    } finally {
      setBusy(false);
    }
  }

  async function doImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pick || !data) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await chordsImport({
        data: {
          portal: data.portal,
          instrumentId: pick.id,
          name: String(f.get("name") ?? pick.name),
          latitude: pick.lat,
          longitude: pick.lon,
          email: String(f.get("email") ?? "") || undefined,
          apiKey: String(f.get("apiKey") ?? "") || undefined,
        },
      });
      if (r.warning) toast.warning(r.warning);
      else toast.success(`Imported ${new Intl.NumberFormat().format(r.rows)} values`);
      void navigate({ to: "/stations/$slug", params: { slug: r.slug } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
      setBusy(false);
    }
  }

  const shown = data?.instruments.filter((i) => `${i.name} ${i.site ?? ""}`.toLowerCase().includes(filter.toLowerCase())) ?? [];

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-sm text-kelp-deep">Bring data in</p>
      <h1 className="mt-1 font-display text-4xl">Import from a CHORDS portal</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Pick any CHORDS portal, choose an instrument, and it becomes one of your stations here: same charts, same downloads,
        kept up to date automatically. Instrument lists are public. Downloading the measurements usually needs the email and
        API key the portal's owner gave you.
      </p>

      <form onSubmit={load} className="mt-6 flex flex-wrap gap-2">
        <input
          value={portal}
          onChange={(e) => setPortal(e.target.value)}
          aria-label="Portal address"
          placeholder="https://your-portal.example.org"
          className="min-h-11 min-w-0 flex-1 rounded-full border border-line bg-card px-4 text-sm"
        />
        <button className={btnPrimary} disabled={busy}>
          {busy && !data ? "Loading…" : "Show instruments"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {PORTALS.map((p) => (
          <button key={p.url} type="button" className="text-kelp underline underline-offset-4" onClick={() => setPortal(p.url)}>
            {p.name}
          </button>
        ))}
      </div>
      {error ? <div className="mt-4"><Notice>{error}</Notice></div> : null}

      {data ? (
        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl">
              {data.instruments.length} instruments on {new URL(data.portal).host}
            </h2>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter"
              aria-label="Filter instruments"
              className="min-h-10 rounded-full border border-line bg-card px-4 text-sm"
            />
          </div>
          <ul className="mt-3 grid max-h-[32rem] gap-2 overflow-y-auto sm:grid-cols-2">
            {shown.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setPick(i)}
                  aria-pressed={pick?.id === i.id}
                  className={`w-full rounded-2xl border bg-card p-3 text-left ${pick?.id === i.id ? "border-kelp" : "border-line"}`}
                >
                  <p className="font-medium">{i.name}</p>
                  <p className="text-xs text-muted">
                    #{i.id}
                    {i.site ? ` · ${i.site}` : ""}
                    {i.lat != null && i.lon != null ? ` · ${i.lat.toFixed(2)}, ${i.lon.toFixed(2)}` : ""}
                  </p>
                  {i.vars.length ? (
                    <p className="mt-1 truncate text-xs text-muted">{i.vars.map((v) => v.name).join(" · ")}</p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pick ? (
        <form onSubmit={doImport} className="mt-6 grid gap-4 rounded-2xl border border-kelp bg-card p-5" key={pick.id}>
          <h2 className="font-display text-xl">Import “{pick.name}”</h2>
          <label className="grid gap-1 text-sm">
            Name here
            <input name="name" defaultValue={pick.name} required maxLength={80} className="min-h-11 rounded-xl border border-line bg-paper px-3" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Portal email (if the portal needs a key)
              <input name="email" type="email" autoComplete="off" className="min-h-11 rounded-xl border border-line bg-paper px-3" />
            </label>
            <label className="grid gap-1 text-sm">
              Portal API key
              <input name="apiKey" type="password" autoComplete="off" className="min-h-11 rounded-xl border border-line bg-paper px-3" />
            </label>
          </div>
          <p className="text-xs text-muted">
            The key is stored encrypted and only used to download this instrument. We fetch the last 30 days first, then
            update every 15 minutes.
          </p>
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={busy}>
              {busy ? "Importing…" : "Import and show it"}
            </button>
            <button type="button" className={btnGhost} onClick={() => setPick(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}
