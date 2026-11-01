import type { SviProfile } from "./svi.ts";
import type { EjProfile } from "./ej.ts";
import type { SurpriseId, WhoId } from "@/lib/wizard/types";
import { ordinal } from "./format.ts";

/**
 * The decision layer. It takes the concerns people named in the wizard, the place profile
 * (SVI and EJScreen), whatever the station is reading now, and the next two days of forecast,
 * and writes a card per concern: where things stand, who it falls on hardest, and the one
 * action the plan says to take. Thresholds are the public ones (NWS advisories, EPA AQI
 * breakpoints, NWS red-flag criteria) so a card can always be explained.
 */

export type Level = "ok" | "watch" | "act" | "unknown";

export type Series = Record<string, Array<{ t: string; v: number }>>;

export type DecisionInput = {
  concerns: SurpriseId[];
  who: WhoId[];
  svi: SviProfile | null;
  ej: EjProfile | null;
  /** Latest reading per measurement key: t, rh, p, rain_1h, rain_24h, pm25, wind, gust, soil, co2, o3. */
  now: Record<string, number>;
  /** Hourly forecast per variable over the next 48–72 h, same keys as `now`. */
  forecast: Series;
  /** Minutes since the station was last heard from, or null if never. */
  silentMinutes: number | null;
};

export type DecisionCard = {
  id: SurpriseId;
  title: string;
  level: Level;
  headline: string;
  evidence: string[];
  exposure: string[];
  action: string;
  thresholds: string;
};

const LEVEL_WORD: Record<Level, string> = {
  ok: "Within normal",
  watch: "Watch",
  act: "Act",
  unknown: "Not measured yet",
};

export function levelWord(level: Level): string {
  return LEVEL_WORD[level];
}

function max(series: Series, key: string, hours = 48): number | null {
  const points = series[key];
  if (!points?.length) return null;
  const slice = points.slice(0, hours);
  return slice.reduce((m, p) => (p.v > m ? p.v : m), -Infinity);
}

function min(series: Series, key: string, hours = 48): number | null {
  const points = series[key];
  if (!points?.length) return null;
  const slice = points.slice(0, hours);
  return slice.reduce((m, p) => (p.v < m ? p.v : m), Infinity);
}

function sum(series: Series, key: string, hours = 24): number | null {
  const points = series[key];
  if (!points?.length) return null;
  return points.slice(0, hours).reduce((s, p) => s + p.v, 0);
}

function worst(...levels: Level[]): Level {
  if (levels.includes("act")) return "act";
  if (levels.includes("watch")) return "watch";
  if (levels.every((l) => l === "unknown")) return "unknown";
  return "ok";
}

function grade(value: number | null, watch: number, act: number, invert = false): Level {
  if (value === null) return "unknown";
  if (invert) return value <= act ? "act" : value <= watch ? "watch" : "ok";
  return value >= act ? "act" : value >= watch ? "watch" : "ok";
}

function factor(svi: SviProfile | null, id: string) {
  return svi?.factors.find((f) => f.id === id) ?? null;
}

function exposureFor(svi: SviProfile | null, ej: EjProfile | null, ids: string[], ejCodes: string[] = []): string[] {
  const lines: string[] = [];
  for (const id of ids) {
    const f = factor(svi, id);
    if (!f || f.rank === null) continue;
    if (f.rank >= 0.75) {
      lines.push(`${f.label}: ${f.percent?.toFixed(1) ?? "—"}% of the tract, ${ordinal(f.rank * 100)} percentile nationally.`);
    }
  }
  if (svi && svi.overall >= 0.75) {
    lines.push(`Overall social vulnerability is high (${ordinal(svi.overall * 100)} percentile).`);
  }
  for (const code of ejCodes) {
    const ind = ej?.environmental.find((e) => e.code === code);
    if (ind?.usPercentile !== null && ind?.usPercentile !== undefined && ind.usPercentile >= 80) {
      lines.push(`${ind.label} already sits at the ${ordinal(ind.usPercentile)} percentile nationally (EJScreen).`);
    }
  }
  return lines;
}

function audience(who: WhoId[]): string {
  if (who.includes("coordinators")) return "the people who step in when something breaks";
  if (who.includes("school")) return "the school";
  if (who.includes("land")) return "whoever works that ground";
  if (who.includes("neighbors")) return "neighbors";
  return "the steward";
}

function fmt(v: number | null, unit: string, digits = 0): string {
  return v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)} ${unit}`;
}

export function decide(input: DecisionInput): DecisionCard[] {
  const { concerns, who, svi, ej, now, forecast, silentMinutes } = input;
  const cards: DecisionCard[] = [];
  const to = audience(who);

  for (const concern of concerns) {
    if (concern === "heat") {
      const tNow = now.t ?? null;
      const tMax = max(forecast, "t");
      const tNight = min(forecast, "t", 36);
      const level = worst(grade(tNow, 32, 38), grade(tMax, 32, 38), grade(tNight, 24, 27));
      cards.push({
        id: concern,
        title: "Heat",
        level,
        headline:
          level === "act"
            ? `Dangerous heat: ${fmt(tMax ?? tNow, "°C")} expected.`
            : level === "watch"
              ? `Hot enough to plan around: ${fmt(tMax ?? tNow, "°C")} in the next two days.`
              : level === "ok"
                ? "No heat threshold is crossed in the next two days."
                : "No temperature reading yet. The card fills in once the station reports.",
        evidence: [
          `Now: ${fmt(tNow, "°C", 1)}. Forecast high (48 h): ${fmt(tMax, "°C", 1)}. Coolest night: ${fmt(tNight, "°C", 1)}.`,
        ],
        exposure: exposureFor(svi, ej, ["AGE65", "DISABL", "NOVEH", "MOBILE"]),
        action:
          level === "act"
            ? `Open the cooling plan today: tell ${to}, check on older neighbors, and move the afternoon hour someone glances at the station to midday.`
            : level === "watch"
              ? `Put the heat line in the group chat and name who looks at the station at 3 pm.`
              : "Keep the afternoon glance on the calendar. Nothing to escalate.",
        thresholds: "Watch at 32 °C (90 °F) daytime or 24 °C nights; act at 38 °C (100 °F) or 27 °C nights.",
      });
    }

    if (concern === "water") {
      const r1 = now.rain_1h ?? null;
      const r24 = now.rain_24h ?? null;
      const f24 = sum(forecast, "rain", 24);
      const level = worst(grade(r1, 12.5, 25), grade(r24, 50, 100), grade(f24, 25, 50));
      cards.push({
        id: concern,
        title: "Water where it causes trouble",
        level,
        headline:
          level === "act"
            ? `Heavy rain: ${fmt(f24 ?? r24 ?? r1, "mm")} in a day is enough to flood the low spot.`
            : level === "watch"
              ? `Rain worth watching: ${fmt(f24 ?? r24, "mm")} over 24 hours.`
              : level === "ok"
                ? "Rain totals stay below the flood line."
                : "No rain reading yet.",
        evidence: [
          `Last hour: ${fmt(r1, "mm", 1)}. Last 24 h: ${fmt(r24, "mm", 1)}. Forecast next 24 h: ${fmt(f24, "mm", 1)}.`,
        ],
        exposure: exposureFor(svi, ej, ["MOBILE", "NOVEH", "DISABL", "LIMENG"], ["proximity.npdes"]),
        action:
          level === "act"
            ? `Walk the culvert and the low street now, and send the reading to ${to} with the time.`
            : level === "watch"
              ? "Name the person who checks the low spot if the hourly total passes 12 mm."
              : "Nothing to do beyond the monthly look at the gauge.",
        thresholds: "Watch at 12.5 mm/h or 50 mm/day; act at 25 mm/h (about 1 in/h) or 100 mm/day.",
      });
    }

    if (concern === "air") {
      const pm = now.pm25 ?? null;
      const pmMax = max(forecast, "pm25");
      const level = worst(grade(pm, 35.5, 55.5), grade(pmMax, 35.5, 55.5));
      cards.push({
        id: concern,
        title: "Air that feels wrong",
        level,
        headline:
          level === "act"
            ? `Unhealthy air: PM2.5 at ${fmt(pmMax ?? pm, "µg/m³")}.`
            : level === "watch"
              ? `Air is unhealthy for sensitive groups: PM2.5 at ${fmt(pmMax ?? pm, "µg/m³")}.`
              : level === "ok"
                ? "PM2.5 stays in the good-to-moderate range."
                : "No particle reading yet.",
        evidence: [`Now: ${fmt(pm, "µg/m³", 1)}. Forecast peak (48 h): ${fmt(pmMax, "µg/m³", 1)}.`],
        exposure: exposureFor(svi, ej, ["AGE65", "AGE17", "DISABL", "UNINSUR"], ["pm", "o3", "dpm", "traffic.score"]),
        action:
          level === "act"
            ? `Move outdoor time indoors and tell ${to}. A high reading does not close a school by itself; the sentence in the plan says what it triggers.`
            : level === "watch"
              ? "Flag the reading to anyone with asthma on the list, and keep the station's next check-in."
              : "Keep the air sentence in the plan current. Nothing to escalate.",
        thresholds: "EPA AQI breakpoints: watch at 35.5 µg/m³ (unhealthy for sensitive groups), act at 55.5 µg/m³ (unhealthy).",
      });
    }

    if (concern === "fire") {
      const rh = now.rh ?? null;
      const wind = now.gust ?? now.wind ?? null;
      const rhMin = min(forecast, "rh");
      const windMax = max(forecast, "wind");
      const pm = now.pm25 ?? null;
      const redFlagNow = rh !== null && wind !== null ? (rh <= 15 && wind >= 11 ? "act" : rh <= 25 && wind >= 7 ? "watch" : "ok") : "unknown";
      const redFlagSoon = rhMin !== null && windMax !== null ? (rhMin <= 15 && windMax >= 11 ? "act" : rhMin <= 25 && windMax >= 7 ? "watch" : "ok") : "unknown";
      const level = worst(redFlagNow as Level, redFlagSoon as Level, grade(pm, 35.5, 55.5));
      cards.push({
        id: concern,
        title: "Wildfire season",
        level,
        headline:
          level === "act"
            ? "Red-flag conditions: dry air and wind together, or smoke already here."
            : level === "watch"
              ? "Fire weather is building: low humidity with wind in the forecast."
              : level === "ok"
                ? "Humidity and wind stay outside red-flag territory."
                : "Needs humidity and wind readings to judge. Smoke uses the particle sensor.",
        evidence: [
          `Humidity now ${fmt(rh, "%")}, lowest forecast ${fmt(rhMin, "%")}. Wind now ${fmt(wind, "m/s", 1)}, forecast peak ${fmt(windMax, "m/s", 1)}. PM2.5 ${fmt(pm, "µg/m³", 1)}.`,
        ],
        exposure: exposureFor(svi, ej, ["NOVEH", "AGE65", "DISABL", "MOBILE", "LIMENG"], ["pm"]),
        action:
          level === "act"
            ? `Share the evacuation route and the smoke plan with ${to} today. Check the station mount; wind firmware may lag the housing.`
            : level === "watch"
              ? "Put the fire-weather line in the group chat and confirm who checks the station at the windiest hour."
              : "Keep the smoke sentence in the plan and the route on paper, not only on a phone.",
        thresholds: "NWS red-flag pattern: relative humidity at or below 15% with sustained wind of 25 mph (11 m/s) is act; 25% and 15 mph (7 m/s) is watch. Smoke follows the PM2.5 breakpoints.",
      });
    }

    if (concern === "storm") {
      const gust = now.gust ?? now.wind ?? null;
      const gustMax = max(forecast, "wind");
      const level = worst(grade(gust, 14, 20.5), grade(gustMax, 14, 20.5));
      cards.push({
        id: concern,
        title: "Wind and storms",
        level,
        headline:
          level === "act"
            ? `Damaging gusts: ${fmt(gustMax ?? gust, "m/s")} expected.`
            : level === "watch"
              ? `Advisory-level wind: ${fmt(gustMax ?? gust, "m/s")} in the forecast.`
              : level === "ok"
                ? "Wind stays below advisory levels."
                : "No wind reading yet. The mount still has to survive the weather you named.",
        evidence: [`Now: ${fmt(gust, "m/s", 1)}. Forecast peak (48 h): ${fmt(gustMax, "m/s", 1)}.`],
        exposure: exposureFor(svi, ej, ["MOBILE", "MUNIT", "AGE65"]),
        action:
          level === "act"
            ? `Tie down what is loose, then tell ${to} who checks the mast after the storm.`
            : level === "watch"
              ? "Walk the tie-downs this week and photograph the mast."
              : "Nothing to do beyond the post-storm check already in the plan.",
        thresholds: "NWS wind advisory: sustained 31 mph (14 m/s) or gusts 46 mph (20.5 m/s) is act.",
      });
    }

    if (concern === "dry") {
      const soil = now.soil ?? null;
      const dryDays = now.dry_days ?? null;
      const f = sum(forecast, "rain", 72);
      const level = worst(grade(soil, 15, 10, true), grade(dryDays, 14, 28));
      cards.push({
        id: concern,
        title: "Dry ground",
        level,
        headline:
          level === "act"
            ? `Soil is dry enough to matter: ${fmt(soil, "% volumetric")}${dryDays !== null ? `, ${dryDays} days without rain` : ""}.`
            : level === "watch"
              ? "Soil moisture is dropping toward the line people argue about."
              : level === "ok"
                ? "Soil moisture is holding."
                : "Soil firmware is still in progress. Rain totals stand in for now.",
        evidence: [
          `Soil: ${fmt(soil, "%", 1)}. Days without rain: ${dryDays ?? "—"}. Rain forecast next 72 h: ${fmt(f, "mm", 1)}.`,
        ],
        exposure: exposureFor(svi, ej, ["POV150", "UNEMP"], ["drinking"]),
        action:
          level === "act"
            ? `Walk the probe location with ${to} and agree what dry means in numbers before anyone argues.`
            : level === "watch"
              ? "Note the reading next to the goal post so the next person inherits the number, not the argument."
              : "Keep the probe siting conversation in the plan.",
        thresholds: "Watch below 15% volumetric water content or 14 dry days; act below 10% or 28 dry days. Adjust to the soil you have.",
      });
    }

    if (concern === "power") {
      const level: Level =
        silentMinutes === null ? "unknown" : silentMinutes > 24 * 60 ? "act" : silentMinutes > 120 ? "watch" : "ok";
      cards.push({
        id: concern,
        title: "Power or contact drops out",
        level,
        headline:
          level === "act"
            ? "The station has been silent for more than a day."
            : level === "watch"
              ? "The station has missed more than two hours of reports."
              : level === "ok"
                ? "The station is reporting."
                : "The station has not reported yet.",
        evidence: [silentMinutes === null ? "No report received." : `Last heard ${Math.round(silentMinutes)} minutes ago.`],
        exposure: exposureFor(svi, ej, ["NOINT" as string]),
        action:
          level === "act"
            ? "Visit the mast: power, link, and a photo. Write down what failed."
            : level === "watch"
              ? "Check the broker from a phone before driving out. A silent station teaches less than a dead one."
              : "Keep the monthly look on the calendar.",
        thresholds: "Watch after 2 hours of silence; act after 24 hours.",
      });
    }

    if (concern === "picture") {
      const anyReading = Object.keys(now).length > 0;
      cards.push({
        id: concern,
        title: "No shared picture yet",
        level: anyReading ? "ok" : "unknown",
        headline: anyReading ? "There is a reading from this place now." : "Nobody has a reading from this place yet.",
        evidence: [anyReading ? `${Object.keys(now).length} measurements on the portal.` : "The first useful thing is a station that really runs."],
        exposure: exposureFor(svi, ej, ["LIMENG", "NOINT" as string]),
        action: anyReading
          ? `Share the first week of readings with ${to}. A photo of the screen is enough.`
          : "Finish the build. Then share the first week with the people who asked for a picture.",
        thresholds: "No threshold. This card closes when the first week of readings has been shared.",
      });
    }
  }
  return cards;
}
