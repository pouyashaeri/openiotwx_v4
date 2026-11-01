import type { Answers, MeasureId } from "@/lib/wizard/types";

/**
 * The printed parts of a station, grouped the way the housing repository is. Print hours match
 * the estimates the plan uses, so the collective's queue and the plan's print-time number agree.
 * STL files: https://github.com/NCAR/openiotwx-stl/tree/main/housing
 */
export type Part = {
  id: string;
  name: string;
  group: "Core" | "Air" | "Rain" | "Sun" | "Air quality" | "Wind" | "Soil";
  hours: number;
  grams: number;
  /** Measurements that call for this part. Empty means every station needs it. */
  needs: MeasureId[];
  /** Shown when `needs` is empty but the part only matters with the precision air sensor. */
  sharpOnly?: boolean;
  tip: string;
};

export const PARTS: Part[] = [
  { id: "orb", name: "Core orb, two halves", group: "Core", hours: 8, grams: 180, needs: [], tip: "Print both halves upright. PETG or ASA outdoors; PLA is fine indoors." },
  { id: "tray", name: "Electronics tray", group: "Core", hours: 2, grams: 40, needs: [], tip: "Holds the Atom Lite and its base. Check the base you chose fits before printing six." },
  { id: "mast", name: "1 inch mast adapter", group: "Core", hours: 2, grams: 45, needs: [], tip: "Threads onto 1 inch PVC. Print at 100% infill where it meets the pipe." },
  { id: "caps", name: "Port caps, set of four", group: "Core", hours: 2, grams: 30, needs: [], tip: "Cap every port you are not using so water and dust stay out." },
  { id: "shield", name: "Radiation shield plates", group: "Air", hours: 6, grams: 120, needs: ["air"], sharpOnly: true, tip: "Stacked plates for the temperature and humidity sensor. White filament keeps it honest in the sun." },
  { id: "rain", name: "RG15 rain gauge adapter", group: "Rain", hours: 4, grams: 70, needs: ["rain"], tip: "Replaces the stock base of the Hydreon RG15 so it screws into the orb." },
  { id: "uv", name: "UV tube and cap", group: "Sun", hours: 4, grams: 55, needs: ["sun"], tip: "The classic guide prints this for the LTR390. Peel the film off the sensor." },
  { id: "aqnode", name: "Air-quality node housing", group: "Air quality", hours: 5, grams: 90, needs: ["pm", "co2", "ozone"], tip: "One housing covers particles, CO2, and ozone. Keep the inlet facing down." },
  { id: "anemo", name: "Anemometer mount", group: "Wind", hours: 4, grams: 80, needs: ["wind"], tip: "Mount for the SENTEC WS302. Firmware for wind is still in progress; the mount can be printed now." },
  { id: "soilstake", name: "Probe gland and stake", group: "Soil", hours: 3, grams: 50, needs: ["soil"], tip: "Cable gland for the RS-485 soil probe. Siting matters more than the print." },
];

export function partsFor(answers: Answers): Part[] {
  return PARTS.filter((part) => {
    if (part.needs.length === 0) return true;
    if (part.sharpOnly && answers.sharp && !answers.measures.includes("air")) return true;
    return part.needs.some((id) => answers.measures.includes(id));
  });
}

export function hoursFor(parts: Part[]): number {
  return parts.reduce((sum, part) => sum + part.hours, 0);
}

export function gramsFor(parts: Part[]): number {
  return parts.reduce((sum, part) => sum + part.grams, 0);
}

export type OfferId = "printer" | "parts" | "hands" | "compute" | "host";

export const OFFERS: Array<{ id: OfferId; label: string; blurb: string }> = [
  { id: "printer", label: "Printer time", blurb: "I can print housings for other stations." },
  { id: "parts", label: "Spare parts", blurb: "I have boards, bases, sensors, or printed parts to pass on." },
  { id: "hands", label: "Build day", blurb: "I can show up to click a station together or mount it." },
  { id: "compute", label: "Forecast compute", blurb: "My computer can run forecast work when it is idle." },
  { id: "host", label: "Server host", blurb: "I can run the community server (a Pi, a PC, or a cloud account)." },
];
