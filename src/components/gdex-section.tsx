import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/connect/api";
import { useConnections } from "@/lib/connect/settings";
import { SHARING, TOOLS } from "@/lib/wizard/catalog";
import type { SensorPick } from "@/lib/wizard/plan";
import { useDraft } from "@/lib/wizard/store";
import { GdexReady } from "@/components/gdex-ready";
import { hasLocation } from "@/lib/wizard/types";
import { cn } from "@/lib/utils";

const LICENSES = ["CC BY 4.0", "CC0 1.0", "ODbL 1.0"] as const;

type Consent = {
  steward: string;
  contact: string;
  license: (typeof LICENSES)[number];
  recordedAt: string | null;
  synced: boolean;
};

const KEY = "openiotwx-consent-v3";

function load(): Consent {
  const base: Consent = { steward: "", contact: "", license: "CC BY 4.0", recordedAt: null, synced: false };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<Consent>) } : base;
  } catch {
    return base;
  }
}

/**
 * Publishing to GDEX is the most open thing the plan can do with the readings, so it gets
 * its own switch, its own preview, and a named person. The publisher service in `infra/`
 * refuses to send anything unless a consent row exists and the switch is on.
 */
export function GdexSection({ sensors, stationCount }: { sensors: SensorPick[]; stationCount: number }) {
  const answers = useDraft((state) => state.answers);
  const siteName = useDraft((state) => state.siteName);
  const setGdex = useDraft((state) => state.setGdex);
  const setStep = useDraft((state) => state.setStep);
  const connections = useConnections();
  const [consent, setConsent] = useState<Consent>(load);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    connections.hydrate();
  }, [connections]);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(consent));
  }, [consent]);

  const variables = sensors.map((s) => `${s.role} (${s.name})`);
  const scope = answers.sharing ?? "local";
  const scopeLabel = SHARING.find((s) => s.id === scope)?.title ?? scope;
  const stationId = (siteName || "station").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  async function record() {
    if (!consent.steward.trim()) {
      toast.error("Name the steward first. Consent needs a person, not a device.");
      return;
    }
    const recordedAt = new Date().toISOString();
    setConsent((c) => ({ ...c, recordedAt, synced: false }));
    setSaving(true);
    const result = await api.consent(connections.apiUrl, {
      station_id: stationId,
      steward: consent.steward.trim(),
      contact: consent.contact.trim(),
      scope,
      gdex: answers.gdex,
      license: consent.license,
    });
    setSaving(false);
    if (result.ok) {
      setConsent((c) => ({ ...c, synced: true }));
      toast.success("Consent recorded on the community server");
    } else {
      toast("Consent recorded on this device. The server was not reachable; it will be sent when you record again with the stack running.");
    }
  }

  return (
    <section aria-labelledby="gdex-title">
      <p className="eyebrow">Data and archive</p>
      <h2 id="gdex-title" className="mt-1 text-2xl">
        What leaves the server, and only if you say so
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Readings live on your own server first; the sharing level is “{scopeLabel}”. {TOOLS.gdex.name} is NSF NCAR's archive for
        analytics-ready data; publishing there means other communities and researchers can cite and reuse the record after
        the project ends.
      </p>

      <GdexReady />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-line bg-panel px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">Archive and publish in GDEX</p>
              <p className="mt-1 text-sm text-muted">
                {answers.gdex
                  ? "On. The publisher packages each month once the consent row exists."
                  : "Off. Nothing is packaged or sent. Turning it on later is this switch."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={answers.gdex}
              onClick={() => setGdex(!answers.gdex)}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full border transition-colors",
                answers.gdex ? "border-brand bg-brand" : "border-line bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-5.5 rounded-full bg-white shadow transition-transform",
                  answers.gdex ? "left-0.5 translate-x-5" : "left-0.5",
                )}
                aria-hidden="true"
              />
              <span className="sr-only">GDEX publishing</span>
            </button>
          </div>

          <div className="mt-4 grid gap-3 border-t border-line pt-4 text-sm">
            <label className="block" htmlFor="steward">
              <span className="text-muted">Data steward (a person)</span>
              <input
                id="steward"
                value={consent.steward}
                onChange={(e) => setConsent((c) => ({ ...c, steward: e.target.value }))}
                className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
                placeholder="Who answers for this data"
              />
            </label>
            <label className="block" htmlFor="contact">
              <span className="text-muted">Contact (shown in the dataset metadata)</span>
              <input
                id="contact"
                value={consent.contact}
                onChange={(e) => setConsent((c) => ({ ...c, contact: e.target.value }))}
                className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
                placeholder="A group address is better than a personal one"
              />
            </label>
            <fieldset>
              <legend className="text-muted">License</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {LICENSES.map((license) => (
                  <button
                    key={license}
                    type="button"
                    aria-pressed={consent.license === license}
                    onClick={() => setConsent((c) => ({ ...c, license }))}
                    className={cn(
                      "min-h-10 rounded-md border px-3 text-sm",
                      consent.license === license ? "border-brand bg-brand-soft" : "border-line bg-panel",
                    )}
                  >
                    {license}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={record}
                disabled={saving}
                className="min-h-11 rounded-md bg-brand px-4 text-sm text-surface disabled:opacity-50 transition-[filter] duration-150 not-disabled:hover:brightness-110"
              >
                {saving ? "Recording…" : "Record this decision"}
              </button>
              <p className="text-xs text-muted">
                {consent.recordedAt
                  ? `Recorded ${new Date(consent.recordedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}${consent.synced ? ", on the server" : ", on this device"}.`
                  : "Not recorded yet."}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel px-4 py-4">
          <p className="font-medium">What the package would contain</p>
          <dl className="mt-3 grid gap-2 text-sm">
            <Row term="Dataset" detail={`OpenIoTwx station readings, ${siteName || "unnamed place"}`} />
            <Row term="Stations" detail={`${stationCount}, id prefix ${stationId || "station"}`} />
            <Row term="Variables" detail={variables.length ? variables.join("; ") : "Chosen in the wizard"} />
            <Row term="Interval" detail="As published by the station (typically 1–10 minutes), plus hourly means" />
            <Row term="Format" detail="CF-1.8 NetCDF per month or quarter, a CSV copy, and a JSON metadata record with place, variables, license and contact" />
            <Row
              term="Location"
              detail={hasLocation(answers.location) ? `${answers.location.lat.toFixed(4)}, ${answers.location.lon.toFixed(4)} (rounded to about 110 m in the released files)` : "Not set"}
            />
            <Row term="License" detail={consent.license} />
            <Row term="Not included" detail="Names of residents, exact addresses, anything from the chat, ticked checklist boxes" />
          </dl>
          <p className="mt-3 text-xs text-muted">
            When the stations are running, each steward gives consent on the station&apos;s page. Releases are built every month or quarter, checked by a person, and pulled by {TOOLS.gdex.name} from a public
            manifest; GDEX assigns the DOI.{" "}
            <Link to="/gdex" className="underline underline-offset-4">
              How it works
            </Link>
            . A new submission starts at{" "}
            <a className="underline underline-offset-4" href={TOOLS.gdex.url}>
              gdex.ucar.edu
            </a>
            .
          </p>
          <p className="no-print mt-3 text-xs text-muted">
            Change the sharing level itself in the{" "}
            <Link to="/wizard" className="underline underline-offset-4" onClick={() => setStep("data")}>
              data step
            </Link>{" "}
            of the wizard.
          </p>
        </div>
      </div>
    </section>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <dt className="text-muted">{term}</dt>
      <dd>{detail}</dd>
    </div>
  );
}
