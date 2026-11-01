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
