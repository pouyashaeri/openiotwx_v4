/**
 * Reads the message format the legacy Raspberry Pi LoRa gateway publishes
 * (`{station_id, sensor, measurement, reading_value, timestamp, rssi}` — one
 * measurement per message) and turns it into this platform's ingest body.
 * Metric names become `<sensor>_<measurement>`. Position messages (latitude,
 * longitude, altitude, or a `station_info` packet) are returned separately so
 * the station's place on the map follows the device, as it did in the legacy listener.
 */
type Msg = Record<string, unknown>;
const POSITION = new Set(["latitude", "longitude", "altitude"]);
const clean = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const num = (v: unknown) => (v === "" || v === null || v === undefined ? Number.NaN : Number(v));

export type Position = { latitude?: number; longitude?: number; elevation?: number };

export function fromGateway(input: unknown): {
  body: { readings: { ts?: unknown; values: Record<string, number> }[] };
  position: Position | null;
  skipped: number;
} {
  const list: unknown[] = Array.isArray(input) ? input : [input];
  const readings: { ts?: unknown; values: Record<string, number> }[] = [];
  const position: Position = {};
  let skipped = 0;
  const take = (key: keyof Position, v: unknown, min: number, max: number) => {
    const n = num(v);
    if (Number.isFinite(n) && n >= min && n <= max) position[key] = n;
  };
  for (const raw of list) {
    const m = (raw ?? {}) as Msg;
    if (m.type === "keep_alive" || m.type === "disconnect") {
      skipped += 1;
      continue;
    }
    if (m.type === "station_info") {
      take("latitude", m.latitude, -90, 90);
      take("longitude", m.longitude, -180, 180);
      take("elevation", m.altitude ?? m.elevation, -500, 9000);
      skipped += 1;
      continue;
    }
    const sensor = clean(m.sensor);
    const measurement = clean(m.measurement);
    if (POSITION.has(measurement)) {
      if (measurement === "latitude") take("latitude", m.reading_value, -90, 90);
      else if (measurement === "longitude") take("longitude", m.reading_value, -180, 180);
      else take("elevation", m.reading_value, -500, 9000);
      skipped += 1;
      continue;
    }
    const value = num(m.reading_value);
    if (!sensor || !measurement || !Number.isFinite(value)) {
      skipped += 1;
      continue;
    }
    readings.push({ ts: m.timestamp, values: { [`${sensor}_${measurement}`.slice(0, 40)]: value } });
  }
  return { body: { readings }, position: Object.keys(position).length ? position : null, skipped };
}
