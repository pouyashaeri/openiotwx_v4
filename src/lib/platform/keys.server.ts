import { createHash, randomBytes } from "node:crypto";

export type StationKey = { key: string; hash: string; hint: string };

/** A station API key is shown once; only its SHA-256 is stored. */
export function newStationKey(): StationKey {
  const key = `iotwx_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashKey(key), hint: key.slice(0, 10) };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "station";
  return `${base}-${randomBytes(2).toString("hex")}`;
}
