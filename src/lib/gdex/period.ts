/**
 * Release periods. A release covers one calendar month or one calendar quarter, in UTC, so a given
 * period always names exactly the same stretch of time.
 *   month:   "2026-10"
 *   quarter: "2026-Q4"
 */

export type Cadence = "monthly" | "quarterly";

export type Period = {
  id: string;
  kind: "month" | "quarter";
  /** Inclusive start, exclusive end (UTC). */
  start: Date;
  end: Date;
  label: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function parsePeriod(id: string): Period | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(id);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    return { id, kind: "month", start: new Date(Date.UTC(y, mo, 1)), end: new Date(Date.UTC(y, mo + 1, 1)), label: `${MONTHS[mo]} ${y}` };
  }
  const q = /^(\d{4})-Q([1-4])$/.exec(id);
  if (q) {
    const y = Number(q[1]);
    const n = Number(q[2]) - 1;
    return { id, kind: "quarter", start: new Date(Date.UTC(y, n * 3, 1)), end: new Date(Date.UTC(y, n * 3 + 3, 1)), label: `Q${n + 1} ${y}` };
  }
  return null;
}

/** The most recent period that has fully ended before `now`. */
export function lastCompletePeriod(cadence: Cadence, now = new Date()): Period {
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  if (cadence === "monthly") {
    const d = new Date(Date.UTC(y, mo - 1, 1));
    return parsePeriod(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`) as Period;
  }
  const q = Math.floor(mo / 3);
  const d = new Date(Date.UTC(y, (q - 1) * 3, 1));
  return parsePeriod(`${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`) as Period;
}

/** Periods that fully ended before `now`, newest first, for pickers. */
export function recentPeriods(cadence: Cadence, count: number, now = new Date()): Period[] {
  const out: Period[] = [];
  let p = lastCompletePeriod(cadence, now);
  for (let i = 0; i < count; i++) {
    out.push(p);
    const before = new Date(p.start.getTime() - 1);
    p = parsePeriod(
      cadence === "monthly"
        ? `${before.getUTCFullYear()}-${String(before.getUTCMonth() + 1).padStart(2, "0")}`
        : `${before.getUTCFullYear()}-Q${Math.floor(before.getUTCMonth() / 3) + 1}`,
    ) as Period;
  }
  return out;
}

export const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
