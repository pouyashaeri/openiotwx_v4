/** "71st", "62nd", "63rd", "88th", "11th". Percentiles read as ordinals, so they should look like them. */
export function ordinal(n: number): string {
  const v = Math.round(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (v % 10) {
    case 1:
      return `${v}st`;
    case 2:
      return `${v}nd`;
    case 3:
      return `${v}rd`;
    default:
      return `${v}th`;
  }
}

/** A 0–1 rank (or 0–100 percentile) as an ordinal, or a dash when missing. */
export function pctile(value: number | null | undefined, scale: 1 | 100 = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return ordinal((value / scale) * 100);
}
