import { create } from "zustand";

/**
 * Where this browser looks for the community's own services. Everything defaults to the
 * hub that this site itself serves at /hub (the same database as accounts and stations). The
 * docker-compose stack in `infra/` is an optional extra: point these at it to use it instead.
 * Nothing here
 * is sent anywhere: it is saved on this device only.
 */
export type Connections = {
  /** FastAPI community server (stations, readings, forecasts, collective, consent). */
  apiUrl: string;
  /** Metabase, the dashboard and decision-analysis tool. */
  metabaseUrl: string;
  /** A public Metabase dashboard link, if one has been shared. Shown inline when set. */
  metabaseDashboard: string;
  /** MQTT broker over WebSockets, for the live feed. */
  mqttWsUrl: string;
  /** Topic filter the live feed subscribes to. */
  mqttTopic: string;
  /** The EJAM API that serves EJScreen indicators. */
  ejamUrl: string;
};

export const DEFAULT_CONNECTIONS: Connections = {
  apiUrl: "/hub",
  metabaseUrl: "http://localhost:3000",
  metabaseDashboard: "",
  mqttWsUrl: "ws://localhost:9001",
  mqttTopic: "ncar/iotwx/#",
  ejamUrl: "https://api.ejanalysis.com",
};

const KEY = "openiotwx-connections-v3";

type ConnectionsState = Connections & {
  hydrated: boolean;
  hydrate: () => void;
  patch: (patch: Partial<Connections>) => void;
  reset: () => void;
};

function pick(state: ConnectionsState): Connections {
  return {
    apiUrl: state.apiUrl,
    metabaseUrl: state.metabaseUrl,
    metabaseDashboard: state.metabaseDashboard,
    mqttWsUrl: state.mqttWsUrl,
    mqttTopic: state.mqttTopic,
    ejamUrl: state.ejamUrl,
  };
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  ...DEFAULT_CONNECTIONS,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    if (typeof window === "undefined") {
      set({ hydrated: true });
      return;
    }
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<Connections>) : null;
      set({ ...DEFAULT_CONNECTIONS, ...(parsed ?? {}), hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  patch: (patch) => set(patch),
  reset: () => set({ ...DEFAULT_CONNECTIONS }),
}));

if (typeof window !== "undefined") {
  useConnections.subscribe((state, previous) => {
    if (!state.hydrated || state === previous) return;
    window.localStorage.setItem(KEY, JSON.stringify(pick(state)));
  });
}

/** Trim a URL the way people paste them: no trailing slash, no surrounding spaces. */
export function cleanUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
