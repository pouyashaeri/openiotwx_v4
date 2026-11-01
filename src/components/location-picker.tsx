import { LocateFixed, Search } from "lucide-react";
import { useState } from "react";
import { geocode, locate } from "@/lib/place/geocode";
import { LOCATION_PLACEHOLDER, questionTitle } from "@/lib/wizard/questions";
import { useDraft } from "@/lib/wizard/store";
import { hasLocation } from "@/lib/wizard/types";

/**
 * The one field that turns a plan into a place on the map. A town, a ZIP, a street corner,
 * or a pair of coordinates. The point is stored on this device with the draft; it is sent to
 * the SVI service, the EJAM API, and your own community server, and nowhere else.
 */
export function LocationPicker({ compact = false }: { compact?: boolean }) {
  const location = useDraft((state) => state.answers.location);
  const setLocation = useDraft((state) => state.setLocation);
  const [text, setText] = useState(location.label);
  const [busy, setBusy] = useState<"search" | "locate" | null>(null);
  const [note, setNote] = useState("");

  async function search() {
    if (!text.trim()) return;
    setBusy("search");
    setNote("");
    const hit = await geocode(text);
    setBusy(null);
    if (!hit) {
      setNote("Nothing found. Try a ZIP code, a town and state, or coordinates like 40.015, -105.27.");
      return;
    }
    setLocation({ lat: hit.lat, lon: hit.lon, label: hit.label });
    setText(hit.label);
  }

  async function useMine() {
    setBusy("locate");
    setNote("");
    const hit = await locate();
    setBusy(null);
    if (!hit) {
      setNote("The browser did not share a location. Type the place instead.");
      return;
    }
    setLocation({ lat: hit.lat, lon: hit.lon, label: hit.label });
    setText(hit.label);
  }

  return (
    <div>
      {!compact ? (
        <label className="block text-sm text-muted" htmlFor="site-location">
          {questionTitle("location")}
        </label>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id="site-location"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
          placeholder={LOCATION_PLACEHOLDER}
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-4 py-3 text-ink"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={search}
          disabled={busy !== null}
          className="inline-flex min-h-12 items-center gap-2 rounded-md bg-brand px-4 text-sm text-surface disabled:opacity-50 transition-[filter] duration-150 not-disabled:hover:brightness-110"
        >
          <Search className="size-4" aria-hidden="true" />
          {busy === "search" ? "Looking…" : "Find"}
        </button>
        <button
          type="button"
          onClick={useMine}
          disabled={busy !== null}
          className="inline-flex min-h-12 items-center gap-2 rounded-md border border-line px-4 text-sm disabled:opacity-50 transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep"
        >
          <LocateFixed className="size-4" aria-hidden="true" />
          {busy === "locate" ? "Asking…" : "Use my location"}
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        {hasLocation(location)
          ? `Set to ${location.label} (${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}). The place profile, forecast, and station record use this point.`
          : "Not set yet. Without a point, the plan shows sample vulnerability data instead of the real tract."}
        {note ? ` ${note}` : ""}
      </p>
    </div>
  );
}
