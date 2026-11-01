import { Link, useNavigate } from "@tanstack/react-router";
import { LocateFixed, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { chordsImport, chordsMap, mapData } from "@/lib/platform/api";
import { PORTALS } from "@/lib/platform/chords-portals";
import { ago, useAsync } from "@/lib/platform/hooks";
import { metricInfo } from "@/lib/platform/metrics";
import type { PortalPin } from "@/lib/platform/chords-remote.server";
import type { MapStation } from "@/lib/platform/service.server";

type Scope = "all" | "mine" | "ncar";
type Base = "streets" | "terrain" | "satellite";
type State = MapStation["state"];

const STATE_COLOR: Record<State, string> = {
  online: "#15803d",
  delayed: "#b45309",
  offline: "#64748b",
  waiting: "#1649c9",
};
const STATE_LABEL: Record<State, string> = {
  online: "Reporting now",
  delayed: "Delayed",
  offline: "Offline",
  waiting: "Waiting for first data",
};
const CHIP_LABEL: Record<State, string> = {
  online: "Online",
  delayed: "Delayed",
  offline: "Offline",
  waiting: "New",
};

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

/** Popup content is built from DOM nodes, so station names can never inject markup. */
function popup(s: MapStation): HTMLElement {
  const el = document.createElement("div");
  el.style.minWidth = "210px";
  const h = document.createElement("strong");
  h.textContent = s.name;
  h.style.fontSize = "15px";
  el.append(h);
  const sub = document.createElement("div");
  sub.style.cssText = "margin:2px 0 6px;font-size:12px;color:#475a7a";
  sub.textContent = `${STATE_LABEL[s.state]} · ${ago(s.last_seen_at)}${s.ncar ? " · NCAR network" : ""}${s.mine ? " · yours" : ""}`;
  el.append(sub);
  const entries = Object.entries(s.values).slice(0, 8);
  if (entries.length) {
    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:13px";
    for (const [k, v] of entries) {
      const info = metricInfo(k);
      const tr = document.createElement("tr");
      const a = document.createElement("td");
      a.textContent = info.label;
      a.style.cssText = "padding:2px 8px 2px 0;color:#475a7a";
      const b = document.createElement("td");
      b.textContent = `${fmt(v.v)}${info.unit ? ` ${info.unit}` : ""}`;
      b.style.cssText = "text-align:right;font-weight:600;font-variant-numeric:tabular-nums";
      tr.append(a, b);
      table.append(tr);
    }
    el.append(table);
  }
  const link = document.createElement("a");
  link.href = `/stations/${encodeURIComponent(s.slug)}`;
  link.textContent = "Open station →";
  link.style.cssText =
    "display:inline-block;margin-top:8px;font-size:13px;font-weight:600;color:#1649c9";
  el.append(link);
  return el;
}

/** An instrument on someone else's CHORDS portal. */
type RemotePin = PortalPin & { portal: string; host: string };
type PortalState = { pins: PortalPin[]; stale: boolean; error: string | null; loading: boolean };

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function remotePopup(p: RemotePin, onImport: (p: RemotePin) => Promise<boolean>): HTMLElement {
  const el = document.createElement("div");
  el.style.minWidth = "210px";
  const h = document.createElement("strong");
  h.textContent = p.name;
  h.style.fontSize = "15px";
  el.append(h);
  const sub = document.createElement("div");
  sub.style.cssText = "margin:2px 0 6px;font-size:12px;color:#475a7a";
  sub.textContent = `CHORDS · ${p.host}${p.site ? ` · ${p.site}` : ""}`;
  el.append(sub);
  if (p.vars.length) {
    const v = document.createElement("div");
    v.style.cssText = "font-size:12px;color:#0a1a3a";
    v.textContent = `Measures: ${p.vars.join(", ")}`;
    el.append(v);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Import to my stations";
  btn.style.cssText =
    "margin-top:10px;padding:7px 14px;border-radius:999px;border:0;background:#1649c9;color:#fff;font:600 13px Inter,system-ui,sans-serif;cursor:pointer";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.style.opacity = "0.6";
    btn.textContent = "Importing…";
    const ok = await onImport(p);
    btn.disabled = ok;
    btn.style.opacity = ok ? "0.6" : "1";
    btn.textContent = ok ? "Imported ✓" : "Import to my stations";
  });
  el.append(btn);
  return el;
}

type MapApi = {
  flyToXY: (lat: number, lon: number) => void;
  renderRemote: (list: RemotePin[]) => void;
  openRemote: (p: RemotePin) => void;
  flyTo: (s: MapStation) => void;
  locate: () => void;
  render: (list: MapStation[], valueKey: string, fit: boolean) => void;
  setBase: (b: Base) => void;
};

export function NetworkMap() {
  const { user } = useCurrentUserState();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => mapData(), [user?.id], 20000);
  const importRef = useRef<(p: RemotePin) => Promise<boolean>>(async () => false);
  importRef.current = async (p) => {
    if (!user) {
      // Come back to this very instrument once signed in.
      const next = `/map?import=${encodeURIComponent(`${p.portal}|${p.id}`)}`;
      void navigate({ to: "/login", search: { next } as never });
      return false;
    }
    try {
      const r = await chordsImport({
        data: {
          portal: p.portal,
          instrumentId: p.id,
          name: p.name.slice(0, 80),
          latitude: p.lat,
          longitude: p.lon,
        },
      });
      const action = {
        label: "Open",
        onClick: () => void navigate({ to: "/stations/$slug", params: { slug: r.slug } }),
      };
      if (r.warning)
        toast.warning(
          `Added ${p.name} to your stations, but no data came with it yet. ${r.warning}`,
          { action },
        );
      else toast.success(`Added ${p.name} to your stations`, { action });
      void reload();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
      return false;
    }
  };
  const [scope, setScope] = useState<Scope>("all");
  const [states, setStates] = useState<Record<State, boolean>>({
    online: true,
    delayed: true,
    offline: true,
    waiting: true,
  });
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [base, setBase] = useState<Base>("streets");
  const [ready, setReady] = useState(false);
  const [portalOn, setPortalOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PORTALS.map((p, i) => [p.url, i === 0])),
  );
  const [extra, setExtra] = useState<string[]>([]);
  const [extraText, setExtraText] = useState("");
  const [remote, setRemote] = useState<Record<string, PortalState>>({});
  const hostEl = useRef<HTMLDivElement>(null);
  const api = useRef<MapApi | null>(null);
  const fitted = useRef(false);

  const all = useMemo(() => data ?? [], [data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (s) =>
        states[s.state] &&
        (scope === "all" || (scope === "mine" ? s.mine : s.ncar)) &&
        (!q || s.name.toLowerCase().includes(q) || s.slug.includes(q)),
    );
  }, [all, scope, states, query]);
  const portals = useMemo(
    () => [
      ...PORTALS.map((p) => ({ name: p.name as string, url: p.url as string })),
      ...extra.map((u) => ({ name: hostOf(u), url: u })),
    ],
    [extra],
  );

  // Look at each switched-on portal once, then again every ten minutes (the server caches too).
  useEffect(() => {
    const load = (url: string) => {
      setRemote((r) => ({
        ...r,
        [url]: { pins: r[url]?.pins ?? [], stale: false, error: null, loading: true },
      }));
      chordsMap({ data: { portal: url } })
        .then(
          (res) =>
            setRemote((r) => ({
              ...r,
              [url]: { pins: res.pins, stale: res.stale, error: null, loading: false },
            })),
        )
        .catch(
          (e) =>
            setRemote((r) => ({
              ...r,
              [url]: {
                pins: [],
                stale: false,
                error: e instanceof Error ? e.message : "Could not reach this portal",
                loading: false,
              },
            })),
        );
    };
    const on = portals.filter((p) => portalOn[p.url] ?? true);
    for (const p of on) if (!remote[p.url]) load(p.url);
    const t = setInterval(() => on.forEach((p) => load(p.url)), 10 * 60_000);
    // A fetch in flight keeps its result when the toggles change meanwhile; only the timer stops.
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portals, portalOn]);

  // Instruments we already carry as stations (imported from the same portal) are not drawn twice.
  const have = useMemo(
    () =>
      new Set(
        all.filter((s) => s.remote).map((s) => `${s.remote!.portal}|${s.remote!.instrumentId}`),
      ),
    [all],
  );
  const remotePins = useMemo<RemotePin[]>(() => {
    if (scope !== "all") return [];
    const q = query.trim().toLowerCase();
    return portals
      .filter((p) => portalOn[p.url] ?? true)
      .flatMap((p) =>
        (remote[p.url]?.pins ?? []).map((pin) => ({
          ...pin,
          portal: p.url.replace(/\/$/, ""),
          host: hostOf(p.url),
        })),
      )
      .filter(
        (p) =>
          !have.has(`${p.portal}|${p.id}`) &&
          (!q || p.name.toLowerCase().includes(q) || (p.site ?? "").toLowerCase().includes(q)),
      );
  }, [scope, portals, portalOn, remote, have, query]);

  const metrics = useMemo(
    () => [...new Set(all.flatMap((s) => Object.keys(s.values)))].sort(),
    [all],
  );
  const counts = {
    total: all.length,
    online: all.filter((s) => s.state === "online").length,
    ncar: all.filter((s) => s.ncar).length,
    mine: all.filter((s) => s.mine).length,
    chords: portals.reduce(
      (n, p) => n + ((portalOn[p.url] ?? true) ? (remote[p.url]?.pins.length ?? 0) : 0),
      0,
    ),
  };

  // Build the map once, in the browser only (Leaflet touches `window`).
  useEffect(() => {
    let dead = false;
    let cleanup = () => {};
    (async () => {
      const L = (await import("leaflet")).default;
      (window as unknown as { L: typeof L }).L = L;
      await import("leaflet.markercluster");
      await import("leaflet/dist/leaflet.css");
      await import("leaflet.markercluster/dist/MarkerCluster.css");
      await import("leaflet.markercluster/dist/MarkerCluster.Default.css");
      if (dead || !hostEl.current) return;
      // Never zoom out past the point where the world fills the map vertically (no grey above or below it).
      const map = L.map(hostEl.current, {
        center: [39.5, -98.35],
        zoom: 4,
        worldCopyJump: true,
        maxBounds: [
          [-85.0511, -Infinity],
          [85.0511, Infinity],
        ],
        maxBoundsViscosity: 1,
      });
      const fitWorld = () => {
        map.setMinZoom(Math.max(0, Math.ceil(Math.log2(map.getSize().y / 256))));
      };
      fitWorld();
      map.on("resize", fitWorld);
      const layers: Record<Base, L.TileLayer> = {
        streets: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors",
        }),
        terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
          maxZoom: 17,
          attribution: "© OpenStreetMap, SRTM · OpenTopoMap",
        }),
        satellite: L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            maxZoom: 19,
            attribution: "Imagery © Esri",
          },
        ),
      };
      let current = layers.streets.addTo(map);
      const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
      map.addLayer(cluster);
      const remoteCluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 45,
      });
      map.addLayer(remoteCluster);
      // Redraws (new data every 20 s) clear every marker; keep whichever popup is open across them.
      let openKey: string | null = null;
      let redrawing = false;
      const keyed = new Map<string, L.Marker>();
      const track = (m: L.Marker, key: string) => {
        keyed.set(key, m);
        m.on("popupopen", () => {
          if (!redrawing) openKey = key;
        });
        m.on("popupclose", () => {
          if (!redrawing && openKey === key) openKey = null;
        });
      };
      const redraw = (body: () => void) => {
        redrawing = true;
        keyed.clear();
        body();
        redrawing = false;
        const again = openKey ? keyed.get(openKey) : undefined;
        if (
          again &&
          (cluster.getVisibleParent(again) === again ||
            remoteCluster.getVisibleParent(again) === again)
        )
          again.openPopup();
      };
      api.current = {
        flyToXY(lat, lon) {
          map.flyTo([lat, lon], Math.max(map.getZoom(), 11));
        },
        openRemote(p) {
          // A popup of its own at the instrument's position: marker clusters would only open it if the map moved.
          map.setView([p.lat, p.lon], Math.max(map.getZoom(), 12), { animate: false });
          L.popup({ offset: [0, -8] })
            .setLatLng([p.lat, p.lon])
            .setContent(remotePopup(p, (pin) => importRef.current(pin)))
            .openOn(map);
        },
        renderRemote(list) {
          redraw(() => {
            remoteCluster.clearLayers();
            for (const p of list) {
              const icon = L.divIcon({
                className: "",
                iconSize: [16, 16],
                iconAnchor: [8, 8],
                html: '<div style="width:16px;height:16px;transform:rotate(45deg);background:#fff;border:3px solid #7c3aed;box-shadow:0 1px 5px rgba(0,0,0,.35)"></div>',
              });
              const m = L.marker([p.lat, p.lon], { icon, title: `${p.name} (CHORDS)` });
              m.bindPopup(() => remotePopup(p, (pin) => importRef.current(pin)));
              track(m, `r|${p.portal}|${p.id}`);
              remoteCluster.addLayer(m);
            }
          });
        },
        setBase(b) {
          map.removeLayer(current);
          current = layers[b].addTo(map);
        },
        flyTo(s) {
          map.flyTo([s.latitude, s.longitude], Math.max(map.getZoom(), 11));
        },
        locate() {
          map.locate({ setView: true, maxZoom: 11 });
        },
        render(list, valueKey, fit) {
          const pts: [number, number][] = [];
          redraw(() => {
            cluster.clearLayers();
            for (const s of list) {
              const v = valueKey ? s.values[valueKey] : undefined;
              const text = v ? fmt(v.v) : "";
              const h = text ? 26 : 22;
              const w = text ? 44 : 22;
              const icon = L.divIcon({
                className: "",
                iconSize: [w, h],
                iconAnchor: [w / 2, h / 2],
                html: `<div style="display:grid;place-items:center;height:${h}px;min-width:${w}px;padding:0 6px;border-radius:999px;background:${STATE_COLOR[s.state]};border:2px solid ${s.ncar ? "#fbbf24" : "#fff"};box-shadow:0 1px 6px rgba(0,0,0,.4);color:#fff;font:600 12px Inter,system-ui,sans-serif">${text}</div>`,
              });
              const m = L.marker([s.latitude, s.longitude], { icon, title: s.name });
              m.bindPopup(() => popup(s));
              track(m, `s|${s.slug}`);
              cluster.addLayer(m);
              pts.push([s.latitude, s.longitude]);
            }
          });
          if (fit && pts.length) map.fitBounds(pts, { padding: [48, 48], maxZoom: 12 });
        },
      };
      setTimeout(() => map.invalidateSize(), 0);
      cleanup = () => {
        api.current = null;
        map.remove();
      };
      setReady(true);
    })();
    return () => {
      dead = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (!ready || !api.current) return;
    api.current.render(shown, label, !fitted.current && shown.length > 0);
    if (shown.length) fitted.current = true;
  }, [ready, shown, label]);
  useEffect(() => {
    if (ready) api.current?.renderRemote(remotePins);
  }, [ready, remotePins]);

  // Returning from sign-in with an instrument to import (?import=<portal>|<id>): show that portal, find the
  // instrument and open its popup, so the visitor only has to press Import again.
  const resume = useRef<{ portal: string; id: number } | null>(null);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("import");
    const [portal, id] = (raw ?? "").split("|");
    if (!portal || !Number(id)) return;
    resume.current = { portal, id: Number(id) };
    setPortalOn((m) => (m[portal] === true ? m : { ...m, [portal]: true }));
    if (!PORTALS.some((p) => p.url === portal)) setExtra((x) => (x.includes(portal) ? x : [...x, portal]));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  useEffect(() => {
    const want = resume.current;
    if (!ready || !want) return;
    const pin = remotePins.find((p) => p.portal === want.portal && p.id === want.id);
    if (!pin || !api.current) return; // its portal is still loading
    api.current.openRemote(pin);
    resume.current = null;
  }, [ready, remotePins]);
  useEffect(() => {
    if (ready) api.current?.setBase(base);
  }, [ready, base]);

  const chip = (on: boolean) =>
    `inline-flex min-h-9 items-center rounded-full border px-3 text-sm transition-colors duration-150 ${on ? "border-kelp bg-kelp text-paper hover:brightness-110" : "border-line bg-card text-ink hover:border-kelp hover:bg-paper-deep"}`;

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(
          [
            ["On the map", counts.total],
            ["Reporting now", counts.online],
            ["NCAR network", counts.ncar],
            ["Yours", counts.mine],
            ["On CHORDS portals", counts.chords],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-card px-3 py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="font-display text-2xl tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "mine", "ncar"] as Scope[]).map((s) => (
          <button
            key={s}
            className={chip(scope === s)}
            aria-pressed={scope === s}
            onClick={() => setScope(s)}
            disabled={s === "mine" && !user}
          >
            {s === "all" ? "All shared" : s === "mine" ? "My stations" : "NCAR network"}
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        {(Object.keys(STATE_LABEL) as State[]).map((k) => (
          <button
            key={k}
            className={chip(states[k])}
            aria-pressed={states[k]}
            onClick={() => setStates((p) => ({ ...p, [k]: !p[k] }))}
          >
            <span
              className="mr-2 size-2.5 rounded-full ring-1 ring-white"
              style={{ background: STATE_COLOR[k] }}
            />
            {CHIP_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="CHORDS portals">
        <span className="text-sm text-muted">CHORDS portals:</span>
        {portals.map((p) => {
          const st = remote[p.url];
          const on = portalOn[p.url] ?? true;
          return (
            <button
              key={p.url}
              className={chip(on)}
              aria-pressed={on}
              title={
                st?.error ??
                (st?.stale ? "Showing the last copy; the portal did not answer" : p.url)
              }
              onClick={() => setPortalOn((m) => ({ ...m, [p.url]: !on }))}
            >
              <span className="mr-2 size-2.5 rotate-45 border-2 border-[#7c3aed] bg-white" />
              {p.name}
              {on && st ? (st.loading ? " …" : st.error ? " ⚠" : ` (${st.pins.length})`) : ""}
            </button>
          );
        })}
        {user ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const t = extraText.trim().replace(/\/$/, "");
              if (t && !portals.some((p) => p.url === t)) setExtra((x) => [...x, t]);
              setExtraText("");
            }}
          >
            <input
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              placeholder="Add a portal address"
              aria-label="Add a CHORDS portal address"
              className="min-h-9 w-48 rounded-full border border-line bg-card px-3 text-sm"
            />
            <button className="min-h-9 rounded-full border border-line bg-card px-3 text-sm transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep">
              Add
            </button>
          </form>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a station"
            aria-label="Find a station"
            className="min-h-11 w-full rounded-full border border-line bg-card pl-9 pr-3 text-sm"
          />
        </label>
        <select
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="Show a value on each pin"
          className="min-h-11 rounded-full border border-line bg-card px-3 text-sm"
        >
          <option value="">Pins: status only</option>
          {metrics.map((m) => (
            <option key={m} value={m}>
              Pins: {metricInfo(m).label}
            </option>
          ))}
        </select>
        <select
          value={base}
          onChange={(e) => setBase(e.target.value as Base)}
          aria-label="Map style"
          className="min-h-11 rounded-full border border-line bg-card px-3 text-sm"
        >
          <option value="streets">Streets</option>
          <option value="terrain">Terrain</option>
          <option value="satellite">Satellite</option>
        </select>
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-card px-4 text-sm transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep"
          onClick={() => api.current?.locate()}
        >
          <LocateFixed className="size-4" /> Near me
        </button>
      </div>

      {error ? <p className="text-sm text-copper">{error}</p> : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <div className="relative overflow-hidden rounded-2xl border border-line">
          <div
            ref={hostEl}
            data-testid="map"
            className="isolate h-[62dvh] min-h-[22rem] w-full bg-paper-deep"
          />
          {!loading && all.length === 0 && remotePins.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-4 top-4 z-[500] rounded-xl bg-card/95 p-3 text-sm shadow">
              No stations with a location yet. Add a latitude and longitude to a station and share
              it to see it here.
            </div>
          ) : null}
        </div>
        <ul
          className="max-h-[62dvh] overflow-y-auto rounded-2xl border border-line bg-card"
          aria-label="Stations on the map"
        >
          {shown.map((s) => (
            <li key={s.slug} className="flex items-center border-b border-line last:border-0">
              <button
                className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left hover:bg-paper-deep"
                onClick={() => api.current?.flyTo(s)}
              >
                <span
                  className="mt-1.5 size-3 shrink-0 rounded-full"
                  style={{ background: STATE_COLOR[s.state] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  <span className="block text-xs text-muted">
                    {STATE_LABEL[s.state]} · {ago(s.last_seen_at)}
                    {s.ncar ? " · NCAR" : ""}
                  </span>
                </span>
              </button>
              <Link
                to="/stations/$slug"
                params={{ slug: s.slug }}
                className="shrink-0 px-3 text-xs font-medium text-kelp"
              >
                Open
              </Link>
            </li>
          ))}
          {remotePins.slice(0, 150).map((p) => (
            <li
              key={`${p.portal}|${p.id}`}
              className="flex items-center border-b border-line last:border-0"
            >
              <button
                className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left hover:bg-paper-deep"
                onClick={() => api.current?.flyToXY(p.lat, p.lon)}
              >
                <span className="mt-1.5 size-3 shrink-0 rotate-45 border-2 border-[#7c3aed] bg-white" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted">CHORDS · {p.host}</span>
                </span>
              </button>
            </li>
          ))}
          {remotePins.length > 150 ? (
            <li className="p-3 text-xs text-muted">
              Showing 150 of {remotePins.length} CHORDS instruments. Search to narrow them down.
            </li>
          ) : null}
          {shown.length === 0 && remotePins.length === 0 ? (
            <li className="p-4 text-sm text-muted">
              {loading ? "Loading…" : "Nothing matches these filters."}
            </li>
          ) : null}
        </ul>
      </div>
      <p className="text-xs text-muted">
        Round pins are stations on this site (a gold ring means the NCAR research network). Purple
        diamonds are instruments listed on CHORDS portals: select one to import it as one of your
        stations.
      </p>
    </div>
  );
}
