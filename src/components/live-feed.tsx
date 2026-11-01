import { useEffect, useRef, useState } from "react";
import { useConnections } from "@/lib/connect/settings";
import { cn } from "@/lib/utils";

type Message = { at: string; topic: string; station: string; measurement: string; value: string };

type FeedState = "idle" | "connecting" | "live" | "error";

/**
 * The live feed: the same MQTT messages the station publishes, straight into the page over
 * WebSockets, before they land in the database. The broker in `infra/` listens on 9001 for
 * this. The client library is loaded only when someone turns the feed on, so the rest of the
 * site stays light.
 */
export function LiveFeed({ className }: { className?: string }) {
  const { mqttWsUrl, mqttTopic } = useConnections();
  const [state, setState] = useState<FeedState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [detail, setDetail] = useState("");
  const clientRef = useRef<{ end: (force?: boolean) => void } | null>(null);

  useEffect(() => () => clientRef.current?.end(true), []);

  async function start() {
    setState("connecting");
    setDetail("");
    try {
      const mqtt = await import("mqtt");
      const client = mqtt.connect(mqttWsUrl, { connectTimeout: 8000, reconnectPeriod: 0, clientId: `openiotwx-web-${Math.random().toString(16).slice(2, 8)}` });
      clientRef.current = client;
      client.on("connect", () => {
        setState("live");
        client.subscribe(mqttTopic || "#", (err) => {
          if (err) setDetail(`Subscribed failed: ${err.message}`);
        });
      });
      client.on("message", (topic, payload) => {
        const text = payload.toString();
        const rows = parse(topic, text);
        setMessages((prev) => [...rows, ...prev].slice(0, 60));
      });
      client.on("error", (err) => {
        setState("error");
        setDetail(`Could not connect: ${err.message}. Is the broker's WebSocket listener on and reachable from this page? Browsers block ws:// from an https:// page.`);
        client.end(true);
      });
      client.on("close", () => {
        setState((s) => (s === "live" ? "idle" : s));
      });
    } catch (error) {
      setState("error");
      setDetail(error instanceof Error ? error.message : "The MQTT client failed to load.");
    }
  }

  function stop() {
    clientRef.current?.end(true);
    clientRef.current = null;
    setState("idle");
  }

  return (
    <section className={cn("rounded-lg border border-line bg-panel", className)} aria-labelledby="feed-title">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <h3 id="feed-title" className="font-medium">
            Live feed
          </h3>
          <p className="text-sm text-muted">
            {mqttWsUrl} · {mqttTopic}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 text-sm text-muted">
            <span
              className={cn(
                "size-2.5 rounded-full",
                state === "live" ? "bg-brand" : state === "connecting" ? "animate-pulse bg-brand/50" : state === "error" ? "bg-warn" : "bg-line",
              )}
              aria-hidden="true"
            />
            {state === "live" ? "Listening" : state === "connecting" ? "Connecting" : state === "error" ? "Not connected" : "Off"}
          </span>
          {state === "live" || state === "connecting" ? (
            <button type="button" onClick={stop} className="min-h-10 rounded-md border border-line px-3 text-sm transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep">
              Stop
            </button>
          ) : (
            <button type="button" onClick={start} className="min-h-10 rounded-md bg-brand px-3 text-sm text-surface transition-[filter] duration-150 not-disabled:hover:brightness-110">
              Listen
            </button>
          )}
        </div>
      </div>
      {detail ? <p className="border-t border-line px-4 py-2 text-sm text-warn">{detail}</p> : null}
      <div className="max-h-72 overflow-auto border-t border-line">
        {messages.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">
            {state === "live"
              ? "Waiting for the first message. A station publishes every reading interval; the `demo_station` service in infra/ publishes one a minute."
              : "Press Listen to subscribe. Messages appear here as they arrive, newest first."}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sr-only">
              <tr>
                <th>Time</th>
                <th>Station</th>
                <th>Measurement</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m, i) => (
                <tr key={`${m.at}-${i}`} className="border-b border-line last:border-0">
                  <td className="px-4 py-1.5 font-mono text-xs text-muted">{m.at}</td>
                  <td className="px-2 py-1.5">{m.station}</td>
                  <td className="px-2 py-1.5 text-muted">{m.measurement}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{m.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/**
 * Stations publish either a JSON object ({"station_id":…, "measurement":…, "reading_value":…}
 * or {"temperature": 21.3, …}) or the classic `station,measurement,value` line. All three
 * become rows here.
 */
function parse(topic: string, text: string): Message[] {
  const at = new Date().toLocaleTimeString("en-US", { hour12: false });
  const station = topic.split("/").filter(Boolean).pop() ?? topic;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    if (typeof json.measurement === "string" && json.reading_value !== undefined) {
      return [{ at, topic, station: String(json.station_id ?? station), measurement: json.measurement, value: String(json.reading_value) }];
    }
    return Object.entries(json)
      .filter(([k, v]) => typeof v === "number" && !["latitude", "longitude", "altitude", "rssi"].includes(k))
      .map(([k, v]) => ({ at, topic, station: String(json.station_id ?? json.station ?? station), measurement: k, value: String(v) }));
  } catch {
    const parts = text.split(",").map((p) => p.trim());
    if (parts.length >= 3) return [{ at, topic, station: parts[0]!, measurement: parts[1]!, value: parts[2]! }];
    return [{ at, topic, station, measurement: "raw", value: text.slice(0, 60) }];
  }
}
