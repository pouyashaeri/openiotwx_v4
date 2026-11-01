import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm-dialog";
import { PlaceForm, STATION_CHANGED } from "@/components/location-fields";
import { btnGhost, btnPrimary } from "@/components/platform-ui";
import { gdexSetConsent, gdexStationState } from "@/lib/gdex/api";
import { useAsync } from "@/lib/platform/hooks";
import { cn } from "@/lib/utils";

const LICENSES = ["CC BY 4.0", "CC0 1.0", "ODbL 1.0"] as const;

/**
 * One station's road to GDEX: what is still missing, and the steward's consent. The station page and the
 * deploy step both show it, because consent belongs to the person who runs the station.
 */
export function GdexPanel({ stationId, compact = false }: { stationId: string; compact?: boolean }) {
  // Checked again every few seconds, so a first reading (or a location saved elsewhere) ticks the list by itself.
  const state = useAsync(() => gdexStationState({ data: { id: stationId } }), [stationId], 5000);
  const s = state.data;
  const reload = state.reload;
  useEffect(() => {
    const onChanged = (e: Event) => {
      const id = (e as CustomEvent<{ stationId?: string }>).detail?.stationId;
      if (!id || id === stationId) void reload();
    };
    window.addEventListener(STATION_CHANGED, onChanged);
    return () => window.removeEventListener(STATION_CHANGED, onChanged);
  }, [stationId, reload]);
  const [steward, setSteward] = useState("");
  const [license, setLicense] = useState<(typeof LICENSES)[number]>("CC BY 4.0");
  const [busy, setBusy] = useState(false);
  const input = "min-h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm";

  async function change(consent: boolean) {
    setBusy(true);
    try {
      if (consent) {
        // The list on screen may be a few seconds old. Look again right now: someone may have cleared the
        // location after it was ticked. The server checks once more when it records the consent.
        const fresh = await gdexStationState({ data: { id: stationId } });
        const missing = fresh?.checks.filter((c) => !c.ok && ["device", "network", "location", "steward"].includes(c.id) && c.id !== "steward");
        if (missing?.length) {
          toast.error(`Not yet: ${missing.map((m) => m.label.toLowerCase()).join(", ")}.`);
          await state.reload();
          return;
        }
      }
      await gdexSetConsent({ data: { id: stationId, consent, steward: steward || s?.consent.steward || "", license } });
      toast.success(consent ? "Consent recorded" : "Consent withdrawn");
      await state.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <section className="mt-4 rounded-xl border border-line bg-paper-deep p-4 text-sm text-muted">{state.error ?? "Checking GDEX readiness…"}</section>;
  const blocking = s.checks.filter((c) => !c.ok && c.id !== "elevation" && c.id !== "mapped" && c.id !== "consent" && c.id !== "steward");

  return (
    <section className="mt-4 rounded-xl border border-line bg-paper-deep p-4" aria-labelledby={`gdex-${stationId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`gdex-${stationId}`} className="font-display text-lg">
          GDEX: the NSF NCAR data archive
        </h3>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs", s.ready ? "bg-moss text-kelp-deep" : "border border-line text-muted")}>
          {s.ready ? "Included in releases" : s.consent.granted ? "Consent given, not ready yet" : "Not included"}
        </span>
      </div>
      {!compact ? (
        <p className="mt-1 text-sm text-muted">
          GDEX keeps research data for the long term and gives it a DOI. Each month (or quarter) the network&apos;s consenting stations are packaged as
          CF-compliant NetCDF with coordinates, units and metadata, and an NCAR data curator reviews and archives it.{" "}
          <Link to="/gdex" className="text-kelp underline underline-offset-4">
            How it works
          </Link>
        </p>
      ) : null}

      <ul className="mt-3 grid gap-1.5 text-sm">
        {s.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <span aria-hidden="true" className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs", c.ok ? "bg-moss text-kelp-deep" : "border border-line text-muted")}>
              {c.ok ? "✓" : "·"}
            </span>
            <span className="min-w-0 flex-1">
              {c.label}
              {c.id === "elevation" && c.ok && s.place.elevation !== null ? <span className="text-muted">{` (${Math.round(s.place.elevation)} m)`}</span> : null}
              {!c.ok ? <span className="block text-xs text-muted">{c.hint}</span> : null}
              {c.id === "location" || c.id === "elevation" ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-kelp underline underline-offset-4 transition-colors duration-150 hover:text-kelp-deep">
                    {c.ok ? "Change" : c.id === "elevation" ? "Add the elevation (optional)" : "Set the location"}
                  </summary>
                  <div className="mt-2 rounded-lg border border-line bg-paper p-3">
                    <PlaceForm stationId={stationId} initial={s.place} onSaved={() => void state.reload()} saveLabel="Save" />
                  </div>
                </details>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      {s.variables.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted transition-colors duration-150 hover:text-ink">How this station&apos;s variables are described in GDEX ({s.variables.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">Reading</th>
                  <th className="py-1 pr-3 font-normal">CF standard name</th>
                  <th className="py-1 font-normal">Units</th>
                </tr>
              </thead>
              <tbody>
                {s.variables.map((v) => (
                  <tr key={v.name} className="border-t border-line">
                    <td className="py-1 pr-3">{v.label}</td>
                    <td className="py-1 pr-3 font-mono">{v.standardName ?? "(described by name only)"}</td>
                    <td className="py-1 font-mono">{v.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {s.consent.granted ? (
        <div className="mt-4">
          {!s.ready ? (
            <p className="mb-2 rounded-lg border border-copper px-3 py-2 text-sm text-copper" role="status">
              This station is left out of releases for now:{" "}
              {s.checks.filter((c) => !c.ok && ["device", "network", "location", "data"].includes(c.id)).map((c) => c.label.toLowerCase()).join(", ") || "it is not active"}.
              It joins the next release as soon as that is fixed. Your consent stays.
            </p>
          ) : null}
          <p className="text-sm text-muted">
            Consent given by <strong className="text-ink">{s.consent.steward}</strong> under {s.consent.license}
            {s.consent.at ? ` on ${new Date(s.consent.at).toLocaleDateString()}` : ""}. Releases already made stay in the archive; you can withdraw for future ones at any time.
          </p>
          <button
            className={`${btnGhost} mt-3`}
            disabled={busy}
            onClick={async () => {
              if (await confirmDialog({ title: "Withdraw consent?", message: "This station is left out of future GDEX releases. Releases already made stay in the archive.", confirmLabel: "Withdraw consent", danger: true })) void change(false);
            }}
          >
            Withdraw consent
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 border-t border-line pt-4">
          <p className="text-sm text-muted">
            Publishing in GDEX is the most open thing that can happen to a station&apos;s readings, so it needs its own yes, from a named person.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-0 flex-1 basis-56 gap-1 text-sm">
              Data steward (a person)
              <input value={steward} onChange={(e) => setSteward(e.target.value)} placeholder="Who answers for this data" className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              License
              <select value={license} onChange={(e) => setLicense(e.target.value as (typeof LICENSES)[number])} className={input}>
                {LICENSES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <button className={btnPrimary} disabled={busy || blocking.length > 0 || !steward.trim()} onClick={() => void change(true)}>
              Give consent to publish in GDEX
            </button>
            {blocking.length ? <p className="mt-2 text-sm text-copper">First: {blocking.map((b) => b.label.toLowerCase()).join(", ")}.</p> : null}
          </div>
        </div>
      )}
    </section>
  );
}
