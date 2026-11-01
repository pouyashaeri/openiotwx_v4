#!/usr/bin/env node
/**
 * MQTT → HTTP bridge. Subscribes to the station topic on the broker and forwards
 * messages, in batches, to the app's /api/ingest/bulk endpoint, which applies the
 * same key check, rate limit and validation as a direct HTTP upload.
 *
 * Raspberry Pi gateways (the legacy mesonet format) publish to `sensors/<station_id>` with no key:
 *   {"station_id":"ABCD-1234","sensor":"bme680","measurement":"temperature","reading_value":"22.5","timestamp":…}
 * The station is found by the gateway id its owner entered on the station page.
 *
 * Direct stations publish to `openiotwx/<anything>` with a JSON payload:
 *   {"key":"iotwx_…","values":{"temp_c":21.4}}            (ts optional)
 *   {"key":"iotwx_…","readings":[{"ts":"…","values":{…}}]}
 *
 * Messages are acknowledged to the broker only after the app has accepted them
 * (QoS 1 shared subscription), so a crash or a saturated app means redelivery,
 * not loss. Duplicates are harmless: the database insert is idempotent.
 *
 * Env: MQTT_URL, MQTT_USER, MQTT_PASSWORD, APP_URL, INGEST_BRIDGE_TOKEN,
 *      MQTT_TOPIC (default openiotwx/#), GATEWAY_TOPIC (default sensors/#), BRIDGE_BATCH (default 200), BRIDGE_FLUSH_MS (default 500)
 */
import mqtt from "mqtt";

const env = (k, d) => process.env[k]?.trim() || d;
const MQTT_URL = env("MQTT_URL", "mqtt://mosquitto:1883");
const APP_URL = env("APP_URL", "http://app:8080").replace(/\/$/, "");
const TOKEN = env("INGEST_BRIDGE_TOKEN");
const TOPIC = env("MQTT_TOPIC", "openiotwx/#");
const GATEWAY_TOPIC = env("GATEWAY_TOPIC", "sensors/#");
const BATCH = Number(env("BRIDGE_BATCH", "200"));
const FLUSH_MS = Number(env("BRIDGE_FLUSH_MS", "500"));

if (!TOKEN) {
  console.error("[bridge] INGEST_BRIDGE_TOKEN is required");
  process.exit(1);
}

let pending = [];
let flushing = false;
let stats = { forwarded: 0, dropped: 0, retried: 0 };

const client = mqtt.connect(MQTT_URL, {
  username: env("MQTT_USER"),
  password: env("MQTT_PASSWORD"),
  clientId: `iotwx-bridge-${process.pid}`,
  clean: false,
  reconnectPeriod: 2000,
});

client.on("connect", () => {
  // Shared subscription: run several bridges and the broker load-balances.
  for (const topic of [TOPIC, GATEWAY_TOPIC]) {
    client.subscribe(`$share/bridge/${topic}`, { qos: 1 }, (err) =>
      console.log(err ? `[bridge] subscribe failed: ${err.message}` : `[bridge] listening on ${topic}`),
    );
  }
});
client.on("error", (e) => console.error("[bridge] mqtt error:", e.message));

// Overriding handleMessage defers the QoS 1 PUBACK until we call `done`.
client.handleMessage = (packet, done) => {
  let body;
  try {
    body = JSON.parse(packet.payload.toString("utf8"));
  } catch {
    stats.dropped += 1;
    return done();
  }
  const topic = String(packet.topic ?? "");
  const gatewayTopic = topic.startsWith("sensors/");
  // A gateway message names its station; the topic's last part is the fallback.
  const gateway = gatewayTopic ? String((Array.isArray(body) ? body[0]?.station_id : body?.station_id) ?? topic.slice(8)) : null;
  const key = typeof body?.key === "string" ? body.key : null;
  if (key) delete body.key;
  pending.push({ item: gateway ? { gateway, body } : { key, body }, done });
  if (pending.length >= BATCH) void flush();
};

async function flush() {
  if (flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending.splice(0, 1000);
  try {
    const res = await fetch(`${APP_URL}/api/ingest/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: JSON.stringify({ items: batch.map((b) => b.item) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`app answered ${res.status}`);
    const { results } = await res.json();
    batch.forEach((b, i) => {
      const status = results?.[i] ?? 500;
      // 2xx accepted; 4xx (bad key, bad payload, rate limit) will never succeed on retry; 5xx/503 will.
      if (status >= 500) {
        pending.push(b);
        stats.retried += 1;
      } else {
        stats.forwarded += status < 300 ? 1 : 0;
        stats.dropped += status < 300 ? 0 : 1;
        b.done();
      }
    });
  } catch (e) {
    console.error("[bridge] forward failed, will retry:", e.message);
    pending.unshift(...batch);
    await new Promise((r) => setTimeout(r, 2000));
  } finally {
    flushing = false;
  }
}

setInterval(() => void flush(), FLUSH_MS);
setInterval(() => {
  console.log(`[bridge] forwarded=${stats.forwarded} dropped=${stats.dropped} retried=${stats.retried} pending=${pending.length}`);
}, 60_000).unref();

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    await flush();
    client.end(false, () => process.exit(0));
  });
}
