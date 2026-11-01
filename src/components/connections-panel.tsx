import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/connect/api";
import { cleanUrl, useConnections } from "@/lib/connect/settings";
import { cn } from "@/lib/utils";

/**
 * Where this browser looks for the community's own services. The defaults point at the
 * docker-compose stack in `infra/` on this machine. Changing them changes nothing on any
 * server: it only tells the page where to look.
 */
export function ConnectionsPanel({ className }: { className?: string }) {
  const c = useConnections();
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    c.hydrate();
  }, [c]);

  async function check() {
    setChecking(true);
    const result = await api.health(c.apiUrl);
    setChecking(false);
    if (result.ok) {
      const services = result.data.services
        ? Object.entries(result.data.services)
            .map(([k, v]) => `${k} ${v ? "up" : "down"}`)
            .join(", ")
        : "";
      setHealth(`Community server answered${result.data.version ? ` (v${result.data.version})` : ""}. ${services}`);
      toast.success("Community server reachable");
    } else {
      setHealth(`Not reachable: ${result.error} The default is this site's own server (/hub). If you pointed this at the infra/ stack, check that it is running.`);
    }
  }

  return (
    <section className={cn("rounded-lg border border-line bg-panel", className)} aria-labelledby="connections-title">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-paper-deep"
      >
        <span>
          <span id="connections-title" className="block font-medium">
            Where the page looks for your services
          </span>
          <span className="block text-sm text-muted">
            Server {cleanUrl(c.apiUrl) || "not set"} · Metabase {cleanUrl(c.metabaseUrl) || "not set"} · MQTT {c.mqttWsUrl || "not set"}
          </span>
        </span>
        <span className="text-sm text-brand-deep underline underline-offset-4">{open ? "Hide" : "Change"}</span>
      </button>
      {open ? (
        <div className="grid gap-3 border-t border-line px-4 py-4 sm:grid-cols-2">
          <Field label="Community server (API)" value={c.apiUrl} onChange={(v) => c.patch({ apiUrl: v })} placeholder="/hub, or http://localhost:8000" />
          <Field label="Metabase" value={c.metabaseUrl} onChange={(v) => c.patch({ metabaseUrl: v })} placeholder="http://localhost:3000" />
          <Field label="Public Metabase dashboard link (optional)" value={c.metabaseDashboard} onChange={(v) => c.patch({ metabaseDashboard: v })} placeholder="http://localhost:3000/public/dashboard/…" />
          <Field label="MQTT over WebSockets" value={c.mqttWsUrl} onChange={(v) => c.patch({ mqttWsUrl: v })} placeholder="ws://localhost:9001" />
          <Field label="MQTT topic filter" value={c.mqttTopic} onChange={(v) => c.patch({ mqttTopic: v })} placeholder="ncar/iotwx/#" />
          <Field label="EJAM API" value={c.ejamUrl} onChange={(v) => c.patch({ ejamUrl: v })} placeholder="https://api.ejanalysis.com" />
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="button" onClick={check} disabled={checking} className="min-h-10 rounded-md bg-brand px-4 text-sm text-surface disabled:opacity-50 transition-[filter] duration-150 not-disabled:hover:brightness-110">
              {checking ? "Checking…" : "Check the server"}
            </button>
            <button type="button" onClick={() => c.reset()} className="min-h-10 rounded-md px-3 text-sm text-muted transition-colors duration-150 not-disabled:hover:bg-paper-deep not-disabled:hover:text-ink">
              Back to defaults
            </button>
            {health ? <p className="text-sm text-muted">{health}</p> : null}
          </div>
          <p className="text-xs text-muted sm:col-span-2">
            Saved on this device only. A phone on the same Wi-Fi can use the host's LAN address, for example http://192.168.1.20:8000.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <label className="block text-sm" htmlFor={id}>
      <span className="text-muted">{label}</span>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}
