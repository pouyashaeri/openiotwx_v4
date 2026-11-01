import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SetupCard, btnPrimary } from "@/components/platform-ui";
import { createStations } from "@/lib/platform/api";

type Flashed = { name: string; latitude: number | null; longitude: number | null };

/**
 * What the flasher remembered about the board it just configured (the flasher is a plain page, so it keeps
 * it in the browser session). A station is only in your account once it is registered here, so this is
 * used to pre-fill the form with the board's own name and, when it has one, its location.
 */
function flashedBoard(): Flashed | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem("iotwx_setup") || "null") as { device?: string; config?: Record<string, unknown> } | null;
    const c = saved?.config;
    if (!c) return null;
    const info = c.station_info as { latitude?: unknown; longitude?: unknown } | undefined;
    const lat = typeof info?.latitude === "number" && info.latitude !== 0 ? info.latitude : null;
    const lon = typeof info?.longitude === "number" && info.longitude !== 0 ? info.longitude : null;
    const id = typeof c.id === "string" ? c.id.trim() : "";
    const name = id || (saved?.device === "rp2040" ? "My weather station" : "");
    return name ? { name: name.slice(0, 80), latitude: lat !== null && lon !== null ? lat : null, longitude: lat !== null && lon !== null ? lon : null } : null;
  } catch {
    return null;
  }
}

/**
 * Register a station in your account: a name and, if the flasher knows it, a location. Shows the one-time
 * key straight away, because the board needs it. `onAdded` gets the new station's slug.
 */
export function AddStation({ onAdded, autoFocus = false }: { onAdded: (slug: string) => void; autoFocus?: boolean }) {
  const [name, setName] = useState("");
  const [board, setBoard] = useState<Flashed | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ slug: string; station: { name: string; expected_metrics: string[] }; apiKey: string } | null>(null);

  useEffect(() => {
    const b = flashedBoard();
    setBoard(b);
    if (b) setName((n) => n || b.name);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      toast.error("Give the station a name first.");
      return;
    }
    setBusy(true);
    try {
      const [row] = await createStations({
        data: { stations: [{ name: n, ...(board && board.latitude !== null && board.longitude !== null ? { latitude: board.latitude, longitude: board.longitude } : {}) }] },
      });
      setMade({ slug: row.station.slug, station: row.station, apiKey: row.apiKey });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the station");
    } finally {
      setBusy(false);
    }
  }

  if (made) {
    return (
      <div className="grid gap-3">
        <SetupCard station={made.station} apiKey={made.apiKey} />
        <div>
          <button type="button" className={btnPrimary} onClick={() => onAdded(made.slug)}>
            Use this station
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      {board ? (
        <p className="text-sm text-muted">
          The board you just configured is called <strong className="text-ink">{board.name}</strong>
          {board.latitude !== null ? ", and its location came along" : ""}. Register it to see it here.
        </p>
      ) : null}
      <label className="grid gap-1 text-sm">
        Station name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoFocus={autoFocus}
          placeholder="North lot, harbor road"
          className="min-h-11 w-full max-w-sm rounded-xl border border-line bg-paper px-3 text-sm text-ink transition-colors hover:border-kelp focus-visible:border-kelp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kelp"
        />
      </label>
      <div>
        <button className={btnPrimary} disabled={busy}>
          {busy ? "Adding…" : "Add station"}
        </button>
      </div>
    </form>
  );
}
