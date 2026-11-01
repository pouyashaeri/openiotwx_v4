import { useState } from "react";
import { toast } from "sonner";
import { btnGhost, btnPrimary } from "@/components/platform-ui";
import { geocode, locateDetailed, lookupElevation } from "@/lib/place/geocode";
import { editStation } from "@/lib/platform/api";

/** Tells other panels on the page (the GDEX checklist) that a station's details changed, so they refresh at once. */
export const STATION_CHANGED = "iotwx:station-changed";

const input = "min-h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm";

/** What the three boxes hold, read as numbers. Elevation is optional; latitude and longitude go together. */
export function readPlace(lat: string, lon: string, elev: string) {
  const la = lat.trim() === "" ? null : Number(lat);
  const lo = lon.trim() === "" ? null : Number(lon);
  const el = elev.trim() === "" ? null : Number(elev);
  const elevationOk = el === null || (Number.isFinite(el) && el >= -500 && el <= 9000);
  const pairOk =
    (la === null && lo === null) ||
    (la !== null && lo !== null && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180);
  return { la, lo, el, elevationOk, valid: pairOk && elevationOk };
}

type Place = { lat: string; lon: string; elev: string };

/**
 * Three ways to fill in where a station is, and none of them is required: search for a place, use this
 * device's position, or type the numbers. Elevation can be looked up from the coordinates.
 */
export function LocationFields({ value, onChange }: { value: Place; onChange: (next: Partial<Place>) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"search" | "device" | "elevation" | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const place = readPlace(value.lat, value.lon, value.elev);
  const hasPoint = place.la !== null && place.lo !== null && Math.abs(place.la) <= 90 && Math.abs(place.lo) <= 180;

  async function findElevation(lat: number, lon: number): Promise<string> {
    const metres = await lookupElevation(lat, lon);
    if (metres === null) return "The elevation service did not answer. Type the elevation, or try again.";
    onChange({ elev: String(metres) });
    return `Elevation ${metres} m.`;
  }

  async function search() {
    if (query.trim().length < 2 || busy) return;
    setBusy("search");
    setNote(null);
    const hit = await geocode(query);
    if (!hit) {
      setNote({ text: "No place found. Try a town, a ZIP, or an address, or type the numbers.", bad: true });
      setBusy(null);
      return;
    }
    onChange({ lat: hit.lat.toFixed(5), lon: hit.lon.toFixed(5) });
    const tail = await findElevation(hit.lat, hit.lon);
    setNote({ text: `Found ${hit.label}. ${tail}`, bad: false });
    setBusy(null);
  }

  async function fromDevice() {
    if (busy) return;
    setBusy("device");
    setNote(null);
    const here = await locateDetailed();
    if (!here.ok) {
      setNote({ text: here.message, bad: true });
      setBusy(null);
      return;
    }
    onChange({ lat: String(here.lat), lon: String(here.lon) });
    if (here.altitude !== null) {
      onChange({ elev: String(here.altitude) });
      setNote({ text: `Got this device's position and altitude (${here.altitude} m).`, bad: false });
    } else {
      const tail = await findElevation(here.lat, here.lon);
      setNote({ text: `Got this device's position. ${tail}`, bad: false });
    }
    setBusy(null);
  }

  async function lookup() {
    if (!hasPoint || busy || place.la === null || place.lo === null) return;
    setBusy("elevation");
    setNote(null);
    const text = await findElevation(place.la, place.lo);
    setNote({ text, bad: text.startsWith("The elevation") });
    setBusy(null);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-[14rem] flex-1 gap-1 text-sm">
          Search for the place
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
            placeholder="Town, ZIP, or address"
            className={input}
          />
        </label>
        <button type="button" className={btnGhost} disabled={busy !== null || query.trim().length < 2} onClick={() => void search()}>
          {busy === "search" ? "Searching…" : "Search"}
        </button>
        <button type="button" className={btnGhost} disabled={busy !== null} onClick={() => void fromDevice()}>
          {busy === "device" ? "Asking the browser…" : "Use this device's location"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Latitude (−90 to 90)
          <input value={value.lat} onChange={(e) => onChange({ lat: e.target.value })} inputMode="decimal" placeholder="39.9784" className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Longitude (−180 to 180)
          <input value={value.lon} onChange={(e) => onChange({ lon: e.target.value })} inputMode="decimal" placeholder="-105.2749" className={input} />
        </label>
        <label className="grid gap-1 text-sm">
          Elevation in metres (optional)
          <div className="flex gap-2">
            <input value={value.elev} onChange={(e) => onChange({ elev: e.target.value })} inputMode="decimal" placeholder="1830" className={input} />
            <button type="button" className={`${btnGhost} shrink-0`} disabled={!hasPoint || busy !== null} onClick={() => void lookup()} title="Look up the elevation at these coordinates">
              {busy === "elevation" ? "…" : "Look up"}
            </button>
          </div>
        </label>
      </div>

      <p role="status" aria-live="polite" className={`min-h-5 text-sm ${note?.bad ? "text-copper" : "text-muted"}`}>
        {note?.text ?? ""}
      </p>
      {!place.valid ? (
        <p className="text-sm text-copper">Latitude and longitude together, within range. Elevation between −500 and 9000 m.</p>
      ) : null}
    </div>
  );
}

/** The fields plus Save, for one station. Used on the station page and inside the GDEX checklist. */
export function PlaceForm({
  stationId,
  initial,
  onSaved,
  saveLabel = "Save location",
}: {
  stationId: string;
  initial: { latitude: number | null; longitude: number | null; elevation: number | null };
  onSaved: () => void;
  saveLabel?: string;
}) {
  const [value, setValue] = useState<Place>({
    lat: initial.latitude?.toString() ?? "",
    lon: initial.longitude?.toString() ?? "",
    elev: initial.elevation?.toString() ?? "",
  });
  const [saving, setSaving] = useState(false);
  const place = readPlace(value.lat, value.lon, value.elev);
  return (
    <div className="grid gap-3">
      <LocationFields value={value} onChange={(next) => setValue((v) => ({ ...v, ...next }))} />
      <div>
        <button
          type="button"
          className={btnPrimary}
          disabled={saving || !place.valid}
          onClick={async () => {
            setSaving(true);
            try {
              await editStation({ data: { id: stationId, latitude: place.la, longitude: place.lo, elevation: place.el } });
              toast.success("Location saved");
              window.dispatchEvent(new CustomEvent(STATION_CHANGED, { detail: { stationId } }));
              onSaved();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not save the location");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
