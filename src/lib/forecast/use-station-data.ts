import { useEffect, useState } from "react";
import { api, type Station } from "@/lib/connect/api";
import { useConnections } from "@/lib/connect/settings";
import type { Series } from "@/lib/place/decide";
import { useDraft } from "@/lib/wizard/store";
import { hasLocation } from "@/lib/wizard/types";
import { demoSeries, forecastToSeries, latest, readingsToSeries } from "./credit.ts";

export type StationData = {
  status: "loading" | "server" | "demo";
  station: Station | null;
  stations: Station[];
  history: Series;
  forecast: Series;
  now: Record<string, number>;
  silentMinutes: number | null;
  note: string;
  reload: () => void;
};

function nearest(stations: Station[], lat: number | null, lon: number | null): Station | null {
  if (!stations.length) return null;
  if (lat === null || lon === null) return stations[0]!;
  let best = stations[0]!;
  let bestD = Infinity;
  for (const s of stations) {
    if (s.latitude === null || s.longitude === null) continue;
    const d = (s.latitude - lat) ** 2 + (s.longitude - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * History, current, and forecast for the station nearest the plan's location. Reads the
 * community server when it answers; otherwise draws a stable sample so the pages can be
 * judged, and says so. `preferred` picks a station id explicitly.
 */
export function useStationData(preferred?: string): StationData {
  const connections = useConnections();
  const location = useDraft((state) => state.answers.location);
  const draftHydrated = useDraft((state) => state.hydrated);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<Omit<StationData, "reload">>({
    status: "loading",
    station: null,
    stations: [],
    history: {},
    forecast: {},
    now: {},
    silentMinutes: null,
    note: "",
  });

  useEffect(() => {
    connections.hydrate();
  }, [connections]);

  useEffect(() => {
    if (!connections.hydrated || !draftHydrated) return;
    let cancelled = false;
    const lat = hasLocation(location) ? location.lat : 40.015;
    const lon = hasLocation(location) ? location.lon : -105.27;

    async function run() {
      const stationsResult = await api.stations(connections.apiUrl);
      if (cancelled) return;
      if (stationsResult.ok && stationsResult.data.length) {
        const stations = stationsResult.data;
        const station = (preferred && stations.find((s) => s.station_id === preferred)) || nearest(stations, lat, lon);
        if (station) {
          const [readings, forecast] = await Promise.all([
            api.readings(connections.apiUrl, station.station_id, 72),
            api.forecast(connections.apiUrl, station.station_id),
          ]);
          if (cancelled) return;
          const history = readings.ok ? readingsToSeries(readings.data) : {};
          const fc = forecast.ok ? forecastToSeries(forecast.data) : {};
          const now = latest(history);
          const silent = station.last_active ? (Date.now() - new Date(station.last_active).getTime()) / 60000 : null;
          setData({
            status: "server",
            station,
            stations,
            history,
            forecast: fc,
            now,
            silentMinutes: silent,
            note: `Readings from ${station.station_id} on your community server${Object.keys(fc).length ? ", with the latest CREDIT run" : ". No forecast run yet"}.`,
          });
          return;
        }
      }
      const demo = demoSeries(lat, lon);
      setData({
        status: "demo",
        station: null,
        stations: stationsResult.ok ? stationsResult.data : [],
        history: demo.history,
        forecast: demo.forecast,
        now: latest(demo.history),
        silentMinutes: 12,
        note: stationsResult.ok
          ? "The server is up but has no stations yet. Showing a sample week so the page can be read."
          : "Sample data: the community server was not reachable from this browser. Check the address under “Where the page looks for your services”.",
      });
    }
    setData((d) => ({ ...d, status: "loading" }));
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections.hydrated, connections.apiUrl, draftHydrated, location.lat, location.lon, preferred, tick]);

  return { ...data, reload: () => setTick((t) => t + 1) };
}
