import { summarize } from "@/lib/platform/summary";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyBlock, Notice, ParamPicker, StatusDot, TimeChart, btnGhost, btnPrimary } from "@/components/platform-ui";
import { chordsSyncNow, editStation, listVariables, newKey, removeStation, setStationParams, stationView } from "@/lib/platform/api";
import { ago, useAsync } from "@/lib/platform/hooks";
import { metricInfo, RANGES, type Range } from "@/lib/platform/metrics";
import { cn } from "@/lib/utils";
import { confirmDialog } from "@/components/confirm-dialog";
import { GdexPanel } from "@/components/gdex-panel";

export const Route = createFileRoute("/stations/$slug")({
  head: () => ({ meta: [{ title: "Station | OpenIoTwx" }] }),
  component: StationPage,
});

function StationPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>("24h");
  const [metric, setMetric] = useState<string | undefined>();
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const view = useAsync(() => stationView({ data: { slug, range, metric } }), [slug, range, metric], 20000);

  if (view.loading && !view.data) return <p className="mx-auto max-w-5xl px-4 py-16 text-muted">Loading station…</p>;
  if (!view.data) {
    return (
      <main id="content" className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="font-display text-4xl">Station not found</h1>
        <p className="mt-3 text-muted">It may be private, or it may have been removed. If it's yours, sign in first.</p>
        <Link to="/stations" className={`${btnGhost} mt-6`}>
          See public stations
        </Link>
      </main>
    );
  }

  const { station, series, canEdit } = view.data;
  const active = view.data.metric;
  const info = active ? metricInfo(active) : null;
  const metrics = Object.entries(station.last_values);
  const summary = summarize(station.last_values);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function act<T>(fn: () => Promise<T>, done?: string): Promise<T | undefined> {
    try {
      const r = await fn();
      if (done) toast.success(done);
      void view.reload();
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
    }
  }

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      {view.error ? <Notice>{view.error}</Notice> : null}
      <p className="text-sm text-kelp-deep">
        <Link to={canEdit ? "/account" : "/stations"}>{canEdit ? "My system" : "Stations"}</Link> /
      </p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-4xl">{station.name}</h1>
        <StatusDot station={station} />
      </div>
      {station.description ? <p className="mt-2 max-w-2xl text-muted">{station.description}</p> : null}
      <p className="mt-1 text-sm text-muted">
        {station.is_public ? "Shared publicly" : "Private"} · last heard {ago(station.last_seen_at)}
        {station.latitude != null && station.longitude != null
          ? ` · ${station.latitude.toFixed(3)}, ${station.longitude.toFixed(3)}`
          : ""}
      </p>

      {summary.length ? (
        <p className="mt-5 max-w-2xl rounded-2xl border border-line bg-card p-4 text-sm" aria-label="Conditions right now">
          <span className="font-medium">Right now: </span>
          {summary.join(" ")}
        </p>
      ) : null}

      {metrics.length ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {metrics.map(([k, x]) => {
            const m = metricInfo(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => setMetric(k)}
                aria-pressed={k === active}
                className={cn(
                  "rounded-2xl border bg-card p-3 text-left",
                  k === active ? "border-kelp" : "border-line",
                )}
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
        <p className="mt-6 rounded-2xl border border-line bg-card p-4 text-sm text-muted">
          Nothing received yet.{" "}
          {canEdit ? "Use the key you were given (or make a new one below) to send a first reading." : ""}
        </p>
      )}

      {active && info ? (
        <section className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl">{info.label}</h2>
            <div className="flex gap-1" role="group" aria-label="Time range">
              {(Object.keys(RANGES) as Range[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={r === range}
                  onClick={() => setRange(r)}
                  className={cn(
                    "min-h-9 rounded-full px-3 text-xs",
                    r === range ? "bg-kelp text-paper" : "border border-line bg-card",
                  )}
                >
                  {RANGES[r].label}
                </button>
              ))}
            </div>
          </div>
          <TimeChart points={series} unit={info.unit} label={info.label} />
          <Downloads station={station} hours={RANGES[range].hours} />
        </section>
      ) : null}

      {canEdit ? (
        <section className="mt-10 rounded-2xl border border-line bg-card p-5">
          <h2 className="font-display text-xl">Manage</h2>
          {station.source === "chords" && station.remote ? (
            <div className="mt-1 text-sm text-muted">
              <p>
                Imported from {station.remote.portal}, instrument {station.remote.instrumentId}. Last update{" "}
                {ago(station.remote.lastSync ?? null)}, checked every {station.remote.everyMin ?? 15} min.
              </p>
              {station.remote.lastError ? <p className="mt-1 text-copper">Last problem: {station.remote.lastError}</p> : null}
              <button
                className={`${btnGhost} mt-3`}
                onClick={() =>
                  act(async () => {
                    const r = await chordsSyncNow({ data: { id: station.id } });
                    toast.success(`Pulled ${r.rows} values`);
                  })
                }
              >
                Update now
              </button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Key {station.api_key_hint}… · CHORDS instrument id {station.chords_id} · limit {station.rate_limit_per_min} uploads a minute
              {station.status === "disabled" ? " · disabled by an administrator" : ""}
            </p>
          )}
          <LocationEditor station={station} onSaved={() => void view.reload()} />
          {station.source === "device" ? (
            <GatewayPanel
              station={station}
              onSave={(gatewayId) => act(() => editStation({ data: { id: station.id, gatewayId } }), gatewayId ? "Gateway id saved" : "Gateway id cleared")}
            />
          ) : null}
          {station.source === "chords" ? (
            <p className="mt-4 rounded-xl bg-paper-deep p-3 text-sm text-muted">
              This is a private view of an instrument on another CHORDS portal. Its data belongs to the portal that publishes it, so it can't be shared or added to the NCAR network from here.
            </p>
          ) : (
          <NcarPanel station={station} onChange={(on) => act(() => editStation({ data: { id: station.id, ncarNetwork: on } }), on ? "Joined the NCAR network" : "Left the NCAR network")} />
          )}
          {station.source === "device" ? <GdexPanel stationId={station.id} /> : null}
          {station.source === "device" ? <ParamsEditor station={station} onSaved={() => void view.reload()} /> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {station.source !== "chords" || station.is_public ? (
            <button
              className={btnGhost}
              onClick={() =>
                act(
                  () => editStation({ data: { id: station.id, isPublic: !station.is_public } }),
                  station.is_public ? "Now private" : "Now shared publicly",
                )
              }
            >
              {station.is_public ? "Make private" : "Share publicly"}
            </button>
            ) : null}
            {station.source === "device" ? (
            <button
              className={btnGhost}
              onClick={async () => {
                if (!(await confirmDialog({ title: "Make a new key?", message: "The station stops uploading until you put the new key on it.", confirmLabel: "Make new key" }))) return;
                const key = await act(() => newKey({ data: { id: station.id } }));
                if (key) setNewApiKey(key);
              }}
            >
              New API key
            </button>
            ) : null}
            <button
              className={btnGhost}
              onClick={async () => {
                const imported = station.source === "chords";
                if (!(await confirmDialog(imported
                  ? { title: "Remove this station?", message: `${station.name} is removed from your account along with the data copied here. The instrument and its data on the CHORDS portal are not affected.`, confirmLabel: "Remove station", danger: true }
                  : { title: "Delete this station?", message: `${station.name} and all its data will be deleted. This can't be undone.`, confirmLabel: "Delete station", danger: true }))) return;
                await removeStation({ data: { id: station.id } });
                void navigate({ to: "/account" });
              }}
            >
              Delete
            </button>
          </div>
          {newApiKey ? (
            <>
              <CopyBlock label="New API key (shown once)" text={newApiKey} />
              <CopyBlock
                label="Test it"
                text={`curl -X POST ${origin}/api/ingest -H "x-api-key: ${newApiKey}" -H "content-type: application/json" -d '{"values":{"temp_c":20}}'`}
              />
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

type StationData = NonNullable<Awaited<ReturnType<typeof stationView>>>["station"];

function Downloads({ station, hours }: { station: StationData; hours: number }) {
  const [custom, setCustom] = useState({ start: "", end: "" });
  const range = custom.start ? `start=${custom.start}&end=${custom.end || new Date().toISOString().slice(0, 16)}` : `start=${new Date(Date.now() - hours * 3600_000).toISOString().slice(0, 19)}`;
  const base = `/instruments/${station.chords_id}`;
  const link = "text-kelp underline underline-offset-4";
  return (
    <div className="mt-3 rounded-2xl border border-line bg-card p-4 text-sm">
      <p className="font-medium">Download this data</p>
      <p className="mt-1 text-muted">
        {custom.start ? "Your dates." : "The range shown above."} All variables, one row per time.
      </p>
      <div className="mt-2 flex flex-wrap gap-4">
        <a className={link} href={`${base}.csv?${range}`}>CSV</a>
        <a className={link} href={`${base}.json?${range}`}>JSON</a>
        <a className={link} href={`${base}.geojson?${range}`}>GeoJSON</a>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-muted">
        <label className="flex items-center gap-1">
          From
          <input type="datetime-local" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} className="min-h-9 rounded-lg border border-line bg-paper px-2 text-ink" />
        </label>
        <label className="flex items-center gap-1">
          To
          <input type="datetime-local" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} className="min-h-9 rounded-lg border border-line bg-paper px-2 text-ink" />
        </label>
        {custom.start ? (
          <button type="button" className="text-kelp underline underline-offset-4 transition-colors duration-150 hover:text-kelp-deep" onClick={() => setCustom({ start: "", end: "" })}>
            Use the shown range
          </button>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-muted">
        The same files are available to other programs at <code>{base}.csv</code> (the CHORDS address format).
      </p>
    </div>
  );
}

function ParamsEditor({ station, onSaved }: { station: StationData; onSaved: () => void }) {
  const [vars, setVars] = useState<{ shortname: string; name: string; units: string; category: string }[]>([]);
  const [selected, setSelected] = useState<string[]>(station.expected_metrics);
  const [strict, setStrict] = useState(station.strict_metrics);
  const [busy, setBusy] = useState(false);
  const load = () => void listVariables().then(setVars).catch(() => undefined);
  useEffect(load, []);
  return (
    <details className="mt-5 rounded-xl border border-line bg-paper p-4">
      <summary className="cursor-pointer text-sm font-medium transition-colors duration-150 hover:text-kelp">
        Variables this station reports ({station.expected_metrics.length})
      </summary>
      <p className="mt-2 text-sm text-muted">
        Tick what this station measures. Turn on "only accept these" to reject anything else a device sends.
      </p>
      <div className="mt-3">
        <ParamPicker variables={vars} selected={selected} onChange={setSelected} onCatalogChange={load} />
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
        Only accept the ticked variables
      </label>
      <button
        type="button"
        className={`${btnPrimary} mt-4`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await setStationParams({ data: { id: station.id, metrics: selected, strict } });
            toast.success("Saved");
            onSaved();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save");
          } finally {
            setBusy(false);
          }
        }}
      >
        Save variables
      </button>
    </details>
  );
}

function LocationEditor({ station, onSaved }: { station: StationData; onSaved: () => void }) {
  const [lat, setLat] = useState(station.latitude?.toString() ?? "");
  const [lon, setLon] = useState(station.longitude?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const la = lat.trim() === "" ? null : Number(lat);
  const lo = lon.trim() === "" ? null : Number(lon);
  const valid = (la === null && lo === null) || (la !== null && lo !== null && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180);
  const input = "min-h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm";
  return (
    <details className="mt-5 rounded-xl border border-line bg-paper p-4" open={station.latitude == null}>
      <summary className="cursor-pointer text-sm font-medium transition-colors duration-150 hover:text-kelp">
        Location {station.latitude != null && station.longitude != null ? `(${station.latitude.toFixed(3)}, ${station.longitude.toFixed(3)})` : "(not set)"}
      </summary>
      <p className="mt-2 text-sm text-muted">
        Where the station is. A forecast is picked for this spot, and the Stations map and downloads carry it.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Latitude (−90 to 90)
          <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="39.9784" className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Longitude (−180 to 180)
          <input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" placeholder="-105.2749" className={input} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || !valid}
          onClick={async () => {
            setBusy(true);
            try {
              await editStation({ data: { id: station.id, latitude: la, longitude: lo } });
              toast.success("Location saved");
              onSaved();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not save the location");
            } finally {
              setBusy(false);
            }
          }}
        >
          Save location
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={() => {
            if (!navigator.geolocation) return toast.error("This browser can't share its location.");
            navigator.geolocation.getCurrentPosition(
              (p) => {
                setLat(p.coords.latitude.toFixed(5));
                setLon(p.coords.longitude.toFixed(5));
              },
              () => toast.error("The browser did not share its location. Type the coordinates instead."),
              { timeout: 10000 },
            );
          }}
        >
          Use this device's location
        </button>
        {!valid ? <span className="text-sm text-copper">Both numbers, within range.</span> : null}
      </div>
    </details>
  );
}

/** Opting a station into the NCAR research network. It is explicit, reversible and needs a location. */
function NcarPanel({ station, onChange }: { station: StationData; onChange: (on: boolean) => void }) {
  const placed = station.latitude != null && station.longitude != null;
  return (
    <section className="mt-4 rounded-xl border border-line bg-paper-deep p-4">
      <h3 className="font-display text-lg">NCAR research network</h3>
      {station.ncar_network ? (
        <>
          <p className="mt-1 text-sm text-muted">
            This station is part of the network{station.ncar_joined_at ? ` since ${new Date(station.ncar_joined_at).toLocaleDateString()}` : ""}. Its
            readings are shared openly on the network map and with the research hub. You can leave at any time; data already shared stays shared.
          </p>
          <button className={`${btnGhost} mt-3`} onClick={async () => {
              if (await confirmDialog({ title: "Leave the NCAR network?", message: "The station stays public until you make it private, and data already shared stays shared.", confirmLabel: "Leave network" })) onChange(false);
            }}>
            Leave the network
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            Want this station to be part of the NCAR research? Joining shares its readings and position openly (it also makes the station public) so
            researchers can use them next to the other stations.
          </p>
          <button className={`${btnPrimary} mt-3`} disabled={!placed} onClick={() => onChange(true)}>
            Join the NCAR network
          </button>
          {!placed ? <p className="mt-2 text-sm text-copper">Set the station's location above first.</p> : null}
        </>
      )}
    </section>
  );
}

/** Links a Raspberry Pi gateway to this station, so the MQTT bridge can file its messages here. */
function GatewayPanel({ station, onSave }: { station: StationData; onSave: (gatewayId: string | null) => void }) {
  const input = "min-h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm";
  const [value, setValue] = useState(station.gateway_id ?? "");
  return (
    <section className="mt-4 rounded-xl border border-line bg-paper-deep p-4">
      <h3 className="font-display text-lg">Raspberry Pi gateway</h3>
      <p className="mt-1 text-sm text-muted">
        Stations that talk over radio reach us through a gateway. Enter the station id the gateway reports (the part after{" "}
        <code>sensors/</code> on the MQTT topic) and its readings will land here.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 basis-56 gap-1 text-sm">
          Gateway station id
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="ABCD-1234" className={input} />
        </label>
        <button className={btnGhost} onClick={() => onSave(value.trim() || null)}>
          Save gateway id
        </button>
      </div>
    </section>
  );
}
