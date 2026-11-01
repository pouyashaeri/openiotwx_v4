import { create } from "zustand";
import { demoEj, fetchEj, type EjProfile } from "./ej.ts";
import { demoSvi, fetchSvi, type SviProfile } from "./svi.ts";

/**
 * The place profile is the SVI tract and the EJScreen buffer around the site. It is fetched
 * once per location and kept on this device, so the plan opens instantly and works offline
 * after the first look. Both sources are public; nothing about the person is sent with the
 * request except the coordinate itself.
 */
export type Status = "idle" | "loading" | "ready" | "partial" | "failed";

type ProfileState = {
  key: string;
  status: Status;
  svi: SviProfile | null;
  ej: EjProfile | null;
  sviError: string | null;
  ejError: string | null;
  hydrated: boolean;
  hydrate: () => void;
  load: (lat: number, lon: number, options: { ejamUrl: string; apiUrl: string; force?: boolean }) => Promise<void>;
  clear: () => void;
};

const KEY = "openiotwx-place-v3";

function keyFor(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export const usePlaceProfile = create<ProfileState>((set, get) => ({
  key: "",
  status: "idle",
  svi: null,
  ej: null,
  sviError: null,
  ejError: null,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    if (typeof window === "undefined") {
      set({ hydrated: true });
      return;
    }
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<ProfileState>) : null;
      if (parsed?.key) {
        set({
          key: parsed.key,
          svi: parsed.svi ?? null,
          ej: parsed.ej ?? null,
          status: parsed.svi || parsed.ej ? (parsed.svi && parsed.ej ? "ready" : "partial") : "idle",
          hydrated: true,
        });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },
  load: async (lat, lon, options) => {
    const key = keyFor(lat, lon);
    const state = get();
    if (!options.force && state.key === key && (state.status === "ready" || state.status === "loading")) return;
    set({ key, status: "loading", sviError: null, ejError: null, ...(state.key === key ? {} : { svi: null, ej: null }) });
    const [svi, ej] = await Promise.all([
      fetchSvi(lat, lon),
      fetchEj(lat, lon, { ejamUrl: options.ejamUrl, apiUrl: options.apiUrl }),
    ]);
    if (get().key !== key) return; // the location moved while we waited
    set({
      svi,
      ej,
      sviError: svi ? null : "No SVI tract was returned for this point. Outside the US, or the service is down.",
      ejError: ej ? null : "EJScreen indicators did not load. The EJAM API is slow at times; the community server can proxy it.",
      status: svi && ej ? "ready" : svi || ej ? "partial" : "failed",
    });
  },
  clear: () => set({ key: "", status: "idle", svi: null, ej: null, sviError: null, ejError: null }),
}));

if (typeof window !== "undefined") {
  usePlaceProfile.subscribe((state, previous) => {
    if (!state.hydrated || state === previous) return;
    if (state.status === "loading") return;
    window.localStorage.setItem(KEY, JSON.stringify({ key: state.key, svi: state.svi, ej: state.ej }));
  });
}

/** What to draw when there is no location yet: a labeled sample so the layout is never empty. */
export function sampleProfile(label: string): { svi: SviProfile; ej: EjProfile } {
  return { svi: demoSvi(label), ej: demoEj() };
}
