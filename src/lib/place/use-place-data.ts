import { useEffect } from "react";
import { useConnections } from "@/lib/connect/settings";
import type { EjProfile } from "./ej.ts";
import { sampleProfile, usePlaceProfile } from "./profile.ts";
import type { SviProfile } from "./svi.ts";
import { useDraft } from "@/lib/wizard/store";
import { hasLocation } from "@/lib/wizard/types";

export type PlaceData = {
  svi: SviProfile | null;
  ej: EjProfile | null;
  status: ReturnType<typeof usePlaceProfile.getState>["status"];
  isSample: boolean;
  located: boolean;
  lat: number | null;
  lon: number | null;
  label: string;
  sviError: string | null;
  ejError: string | null;
  reload: () => void;
};

/** Loads the place profile for the draft's location, or hands back a labeled sample. */
export function usePlaceData(): PlaceData {
  const location = useDraft((state) => state.answers.location);
  const siteName = useDraft((state) => state.siteName);
  const draftHydrated = useDraft((state) => state.hydrated);
  const connections = useConnections();
  const profile = usePlaceProfile();
  const located = hasLocation(location);

  useEffect(() => {
    connections.hydrate();
    profile.hydrate();
  }, [connections, profile]);

  useEffect(() => {
    if (!draftHydrated || !profile.hydrated || !connections.hydrated || !located) return;
    void profile.load(location.lat, location.lon, { ejamUrl: connections.ejamUrl, apiUrl: connections.apiUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftHydrated, profile.hydrated, connections.hydrated, located, location.lat, location.lon]);

  const sample = located ? null : sampleProfile(siteName || location.label);
  return {
    svi: located ? profile.svi : sample!.svi,
    ej: located ? profile.ej : sample!.ej,
    status: located ? profile.status : "ready",
    isSample: !located,
    located,
    lat: located ? location.lat : null,
    lon: located ? location.lon : null,
    label: location.label || siteName,
    sviError: located ? profile.sviError : null,
    ejError: located ? profile.ejError : null,
    reload: () => {
      if (located) void profile.load(location.lat, location.lon, { ejamUrl: connections.ejamUrl, apiUrl: connections.apiUrl, force: true });
    },
  };
}

