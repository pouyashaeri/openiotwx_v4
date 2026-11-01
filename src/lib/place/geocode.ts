/**
 * Turning what a person typed into a point on the map. Three ways in:
 *  1. "Use my location" from the browser.
 *  2. A pair of numbers ("40.015, -105.27").
 *  3. A place name or ZIP, looked up with OpenStreetMap's Nominatim (one request per search,
 *     which is inside its usage policy for a site like this).
 */

export type GeoHit = { lat: number; lon: number; label: string };

export function parseCoordinates(text: string): GeoHit | null {
  const match = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
}

export async function geocode(query: string): Promise<GeoHit | null> {
  const direct = parseCoordinates(query);
  if (direct) return direct;
  const q = query.trim();
  if (q.length < 2) return null;
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "1",
    countrycodes: "us",
    addressdetails: "0",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    const first = rows[0];
    if (!first) return null;
    const label = first.display_name.split(",").slice(0, 3).join(",").trim();
    return { lat: Number(first.lat), lon: Number(first.lon), label };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function locate(): Promise<GeoHit | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude.toFixed(5));
        const lon = Number(position.coords.longitude.toFixed(5));
        resolve({ lat, lon, label: `My location (${lat}, ${lon})` });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}

/**
 * Metres above sea level at a point, from Open-Meteo's free elevation service (a 90 m terrain model, no key).
 * One request per lookup, made only when someone asks for it. Null when the service cannot be reached.
 */
export async function lookupElevation(lat: number, lon: number): Promise<number | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const params = new URLSearchParams({ latitude: lat.toFixed(5), longitude: lon.toFixed(5) });
    const response = await fetch(`https://api.open-meteo.com/v1/elevation?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { elevation?: unknown[] };
    const metres = Number(body.elevation?.[0]);
    return Number.isFinite(metres) ? Math.round(metres) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type LocateResult = { ok: true; lat: number; lon: number; altitude: number | null } | { ok: false; message: string };

/**
 * The browser's own position, with a reason in plain words when it cannot be had. Browsers share location
 * only on secure pages (https, or localhost itself), which is the usual reason it "does nothing".
 */
export function locateDetailed(): Promise<LocateResult> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, message: "This browser cannot share its location. Search for a place or type the numbers." });
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      resolve({
        ok: false,
        message: `Browsers only share location on secure pages. Open this site at http://localhost:${window.location.port || "8080"} instead of the network address, or search for a place.`,
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const altitude = position.coords.altitude;
        resolve({
          ok: true,
          lat: Number(position.coords.latitude.toFixed(5)),
          lon: Number(position.coords.longitude.toFixed(5)),
          altitude: altitude !== null && Number.isFinite(altitude) ? Math.round(altitude) : null,
        });
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location is blocked for this site. Click the lock icon beside the address, allow Location, and try again. On Windows, also check Settings, Privacy and security, Location."
            : error.code === error.POSITION_UNAVAILABLE
              ? "This device could not work out where it is. Turn on location services (on Windows: Settings, Privacy and security, Location), or search for a place."
              : "Finding the location took too long. Try again, or search for a place.";
        resolve({ ok: false, message });
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 },
    );
  });
}
