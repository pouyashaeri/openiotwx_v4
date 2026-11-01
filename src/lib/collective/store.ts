import { create } from "zustand";

export type PrintStatus = "queued" | "printing" | "done" | "failed";

/** One row of the print queue: a part for one station, and who is printing it. */
export type QueueRow = { station: string; part: string; status: PrintStatus; owner: string };

export type Offer = {
  id: string;
  name: string;
  contact: string;
  area: string;
  offers: string[];
  printers: string;
  notes: string;
  createdAt: string;
  /** True once the server has it. Local-only rows stay on this device. */
  synced: boolean;
};

type CollectiveState = {
  hydrated: boolean;
  queue: QueueRow[];
  offers: Offer[];
  hydrate: () => void;
  setStatus: (station: string, part: string, status: PrintStatus) => void;
  setOwner: (station: string, part: string, owner: string) => void;
  seed: (rows: QueueRow[]) => void;
  addOffer: (offer: Omit<Offer, "id" | "createdAt" | "synced">) => Offer;
  markSynced: (id: string) => void;
  mergeServerOffers: (offers: Offer[]) => void;
  clear: () => void;
};

const KEY = "openiotwx-collective-v3";

export const useCollective = create<CollectiveState>((set, get) => ({
  hydrated: false,
  queue: [],
  offers: [],
  hydrate: () => {
    if (get().hydrated) return;
    if (typeof window === "undefined") {
      set({ hydrated: true });
      return;
    }
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<CollectiveState>) : null;
      set({
        queue: Array.isArray(parsed?.queue) ? parsed!.queue! : [],
        offers: Array.isArray(parsed?.offers) ? parsed!.offers! : [],
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
  setStatus: (station, part, status) =>
    set({
      queue: get().queue.map((row) =>
        row.station === station && row.part === part ? { ...row, status } : row,
      ),
    }),
  setOwner: (station, part, owner) =>
    set({
      queue: get().queue.map((row) =>
        row.station === station && row.part === part ? { ...row, owner } : row,
      ),
    }),
  // Keep statuses already set; only add rows for parts/stations that are new to the plan.
  seed: (rows) => {
    const current = get().queue;
    const next = rows.map(
      (row) => current.find((c) => c.station === row.station && c.part === row.part) ?? row,
    );
    set({ queue: next });
  },
  addOffer: (offer) => {
    const row: Offer = {
      ...offer,
      id: `offer-${Date.now()}`,
      createdAt: new Date().toISOString(),
      synced: false,
    };
    set({ offers: [row, ...get().offers] });
    return row;
  },
  markSynced: (id) =>
    set({ offers: get().offers.map((o) => (o.id === id ? { ...o, synced: true } : o)) }),
  mergeServerOffers: (incoming) => {
    const local = get().offers.filter((o) => !o.synced);
    set({ offers: [...local, ...incoming] });
  },
  clear: () => set({ queue: [], offers: [] }),
}));

if (typeof window !== "undefined") {
  useCollective.subscribe((state, previous) => {
    if (!state.hydrated || state === previous) return;
    window.localStorage.setItem(KEY, JSON.stringify({ queue: state.queue, offers: state.offers }));
  });
}
