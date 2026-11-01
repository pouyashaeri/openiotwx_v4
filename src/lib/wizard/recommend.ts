import { CONFIGS } from "./catalog.ts";
import type { Answers, ConfigId, MeasureId } from "./types.ts";

export type Decline = { id: ConfigId; name: string; because: string };

export type Recommendation = {
  configId: Exclude<ConfigId, "E">;
  experimental: boolean;
  reasons: string[];
  declined: Decline[];
  ports: string[];
  power: string;
  baseLine: string;
  baseCents: number;
  includePoeBase: boolean;
  /** Things the sheet says cannot be built as asked; the plan drops or changes something and says what. */
  conflicts: string[];
};

const QWIIC: MeasureId[] = ["air", "pm", "co2", "ozone", "sun"];

function has(answers: Answers, id: MeasureId): boolean {
  return answers.measures.includes(id);
}

function qwiicCount(answers: Answers): number {
  return QWIIC.filter((id) => has(answers, id)).length;
}

function rs485Count(answers: Answers): number {
  return (has(answers, "wind") ? 1 : 0) + (has(answers, "soil") ? 1 : 0);
}

function decline(
  chosen: Exclude<ConfigId, "E">,
  lines: Record<Exclude<ConfigId, "E">, string>,
  experimental: boolean,
): Decline[] {
  const ids: Array<Exclude<ConfigId, "E">> = ["A", "B", "C", "D"];
  const rows: Decline[] = ids
    .filter((id) => id !== chosen)
    .map((id) => ({ id, name: CONFIGS[id].name, because: lines[id] }));
  rows.push({
    id: "E",
    name: CONFIGS.E.name,
    because: experimental
      ? "Kept as a later experiment. There is no board to flash yet, so it is not the station in this draft."
      : "Amateur radio at 1.8–30 MHz is only for sites past every other link, and the board is still unchosen.",
  });
  return rows;
}

function powerLine(
  configId: Exclude<ConfigId, "E">,
  answers: Answers,
  fallback: string,
): string {
  if (answers.power === "outlet") {
    return fallback.startsWith("Power over Ethernet")
      ? fallback
      : "A wall outlet with a USB power adapter";
  }
  if (answers.power === "solar") {
    const watts = configId === "C" ? "about 20 W" : configId === "D" ? "about 10 W" : "6–10 W";
    return `A solar panel, ${watts}`;
  }
  return fallback;
}

/**
 * The configuration matrix (columns A–E of the NCAR configuration sheet) is the
 * source of truth for everything below. Rows used here:
 *
 *   Communication ........ picks the family: Wi-Fi/PoE → A or B, cellular → C, LoRa → D, ham → E
 *   Deployment scenario .. CONFIG_FIT (soft: warns and names the build that fits the place)
 *   Measurement scenario . "simple" = fits the classic build's single Grove serial slot (see classicFit)
 *   PoE ................. only A, and only with the PoE base
 *   RS485 / Rain gauge .. A: one serial slot, rain XOR one RS-485 sensor, no RS-485 with PoE,
 *                         no rain + Qwiic with PoE. B: up to 3, C/D: up to 2 (native + Port A)
 *   Power ............... A: PoE or USB plug; B: 6–10 W solar or plug; C: 20 W; D: 10 W; E: 20 W
 */
type Class = "urban" | "suburban" | "semi-rural" | "rural" | "remote" | "extreme";

/** What the sheet calls a place, for each answer the wizard offers. */
const PLACE_CLASSES: Record<NonNullable<Answers["place"]>, Class[]> = {
  indoors: ["urban"],
  home: ["urban"],
  urban: ["urban"],
  edge: ["suburban"],
  farm: ["semi-rural", "rural"],
  rural: ["rural"],
  extreme: ["remote", "extreme"],
};

/** "Deployment scenario" row. */
export const CONFIG_FIT: Record<ConfigId, Class[]> = {
  A: ["urban"],
  B: ["urban"],
  C: ["urban", "suburban", "semi-rural"],
  D: ["rural", "remote", "urban", "suburban"],
  E: ["extreme"],
};

export function fitsPlace(id: ConfigId, place: Answers["place"]): boolean {
  if (!place) return true;
  return PLACE_CLASSES[place].some((c) => CONFIG_FIT[id].includes(c));
}

/** Soft rule: the link you chose is kept, but say so when the sheet fits a different build to this place. */
function placeFit(answers: Answers, chosen: Exclude<ConfigId, "E">): string | null {
  if (!answers.place || fitsPlace(chosen, answers.place)) return null;
  const better = (["C", "D"] as const).filter((id) => id !== chosen && fitsPlace(id, answers.place));
  const where = PLACE_CLASSES[answers.place].join(" / ");
  const listed = CONFIG_FIT[chosen].join(", ");
  const lead = `${CONFIGS[chosen].name} is specified for ${listed} sites, and you described this one as ${where}.`;
  if (answers.place === "extreme" && chosen !== "D") {
    return `${lead} For a site this remote the sheet lists radio: the LoRa build (D) today, and long-haul amateur radio (E) once a board exists.`;
  }
  if (better.length) {
    const names = better.map((id) => `${CONFIGS[id].name} (${id})`).join(" or ");
    return `${lead} That holds only if the link really reaches the mast. If it does not, the sheet fits ${names} here.`;
  }
  return lead;
}

/**
 * "Measurement scenario: simple" for the classic build (A). A has one Grove
 * serial slot, used by the rain gauge OR one RS-485 sensor, never both and never
 * two RS-485 sensors. PoE removes RS-485 entirely, and PoE with rain cannot
 * also carry a Qwiic chain. A is powered by PoE or a USB plug, not solar.
 * Anything the list needs beyond that is "multi-measurement" and goes to B.
 */
export function classicFit(answers: Answers, withPoe: boolean): { ok: boolean; blockers: string[] } {
  const rain = has(answers, "rain");
  const rs = rs485Count(answers);
  const qwiic = qwiicCount(answers) > 0;
  const blockers: string[] = [];
  if (rs > 1) blockers.push("The classic build carries one RS-485 sensor at most, and wind plus soil is two.");
  if (rain && rs > 0) {
    blockers.push("The classic build has one Grove serial slot: the rain gauge or one RS-485 sensor, not both.");
  }
  if (withPoe && rs > 0) blockers.push("RS-485 cannot share the classic build with the PoE base.");
  if (withPoe && rain && qwiic) blockers.push("Rain with a Qwiic chain cannot share the classic build with the PoE base.");
  if (!withPoe && answers.power === "solar") {
    blockers.push("The classic build is powered by PoE or a USB plug. Solar needs the PortABC base (6–10 W) or a larger one.");
  }
  return { ok: blockers.length === 0, blockers };
}

function loraPartner(answers: Answers): string | null {
  if ((answers.count ?? 1) < 2) {
    return "One LoRa station still needs a partner that can hear it: a second node beside a desk, or a gateway later. Pair-to-pair does not require LoRaWAN.";
  }
  return "With more than one station, LoRa can run pair-to-pair and skip a gateway. The base in this plan is the US915 version. Other regions need a different radio.";
}

export function recommend(answers: Answers): Recommendation {
  const rain = has(answers, "rain");
  const qwiic = qwiicCount(answers) > 0;
  const rs = rs485Count(answers);
  const poe = answers.link === "poe";
  const conflicts: string[] = [];

  const finish = (
    configId: Exclude<ConfigId, "E">,
    extra: string[],
    ports: string[],
    power: string,
    baseLine: string,
    baseCents: number,
    includePoeBase: boolean,
    experimental: boolean,
    declined: Record<Exclude<ConfigId, "E">, string>,
  ): Recommendation => {
    const fit = placeFit(answers, configId);
    return {
      configId,
      experimental,
      reasons: [...(fit ? [fit] : []), ...extra],
      conflicts,
      declined: decline(configId, declined, experimental),
      ports,
      power: powerLine(configId, answers, power),
      baseLine,
      baseCents,
      includePoeBase,
    };
  };

  // Communication row: the link names the family.
  if (answers.link === "ham") {
    return finish(
      "D",
      [
        "You asked for a path past cellular range. Long-haul ham radio (WSPR/APRS, 1.8–30 MHz) has no chosen board yet, so this draft builds the LoRa station you can assemble and keeps ham radio as a later experiment.",
        loraPartner(answers) ?? "",
      ].filter(Boolean),
      portsFor("D", answers),
      CONFIGS.D.power,
      `${CONFIGS.D.base} (${CONFIGS.D.baseCost})`,
      CONFIGS.D.baseCents,
      false,
      true,
      {
        A: "A building drop does not reach a site this far out.",
        B: "Neighborhood Wi-Fi still needs a hotspot at the mast.",
        C: "Cellular was not the link you can count on here.",
        D: "",
      },
    );
  }

  if (answers.link === "lora") {
    return finish(
      "D",
      [
        "LoRa matches a plan where the stations themselves are the network. Pair-to-pair needs no gateway. The listed base is US915.",
        loraPartner(answers) ?? "",
        rs
          ? "Wind and soil ride RS-485. On this base that is the native port plus Port A, two devices at most. Firmware for both sensors is still in progress."
          : "",
      ].filter(Boolean),
      portsFor("D", answers),
      CONFIGS.D.power,
      `${CONFIGS.D.base} (${CONFIGS.D.baseCost})`,
      CONFIGS.D.baseCents,
      false,
      false,
      {
        A: "The classic drop assumes a hotspot or a network cable.",
        B: "The Wi-Fi base is the wrong radio for this link.",
        C: "Cellular is the other way to leave Wi-Fi behind. You chose station-to-station radio instead.",
        D: "",
      },
    );
  }

  if (answers.link === "cell") {
    return finish(
      "C",
      [
        "An NB-IoT SIM in the base reports where a hotspot will not. Activate the SIM before field day, and budget a 20 W panel or a plug.",
        rs
          ? "Wind and soil use RS-485, two devices maximum on this base (native plus Port A). Treat both as firmware-in-progress, not plug-and-play."
          : "Rain, if you selected it, stays on the microcontroller Grove port.",
      ],
      portsFor("C", answers),
      CONFIGS.C.power,
      `${CONFIGS.C.base} (${CONFIGS.C.baseCost})`,
      CONFIGS.C.baseCents,
      false,
      false,
      {
        A: "The classic station has no internal cellular radio.",
        B: "Wi-Fi alone was not the link you said reaches this mast.",
        C: "",
        D: "Choose radio instead if the SIM will not register at the site. LoRa can pair without a gateway.",
      },
    );
  }

  // Wi-Fi or PoE: A (Atom Lite alone, "simple") or B (PortABC base, "multi-measurement").
  // PoE exists only on A. If A cannot carry the PoE base with this sensor list,
  // no configuration can, so PoE is dropped and said so, then the Wi-Fi rule runs.
  if (poe) {
    const withPoe = classicFit(answers, true);
    if (withPoe.ok) {
      return finish(
        "A",
        [
          "A network drop with power on the cable fits the classic station. The PoE base is the extension under the Atom Lite.",
          rain
            ? "The rain gauge takes the Grove port. Do not add an RS-485 sensor to this classic build."
            : "Qwiic parts chain on the GPIO header, up to eight.",
        ],
        portsFor("A", answers, true),
        "Power over Ethernet from the W5500 base",
        `${CONFIGS.A.base} (${CONFIGS.A.baseCost})`,
        CONFIGS.A.baseCents,
        true,
        false,
        {
          A: "",
          B: "The PortABC base has no PoE. It is for RS-485 instruments or a longer list than the classic drop carries.",
          C: "Cellular adds a SIM and a larger power budget you did not ask for.",
          D: "Radio is the switch to make if the cable stops reaching the mast.",
        },
      );
    }
    conflicts.push(
      `PoE cannot be built with this sensor list. Only the classic build has a PoE base, and: ${withPoe.blockers.join(" ")} This plan drops PoE and powers the station from a USB plug. To keep PoE, remove the sensor named above.`,
    );
  }

  const classic = classicFit(answers, false);
  if (classic.ok) {
    return finish(
      "A",
      [
        "A short sensor list on a real hotspot fits the classic Atom Lite. Skip the PoE base unless a network drop is actually there.",
        rs
          ? "One RS-485 sensor rides the Grove serial port on this build, which is why the rain gauge cannot share it. Its firmware is still in progress."
          : rain
            ? "The rain gauge takes the Grove port."
            : "Qwiic parts chain on the GPIO header, up to eight.",
      ],
      portsFor("A", answers, false),
      CONFIGS.A.power,
      "No extension base required. Add the PoE base later only if a network drop appears ($18.50).",
      0,
      false,
      false,
      {
        A: "",
        B: "The PortABC base is for a longer list: more RS-485 sensors, or rain and RS-485 together.",
        C: "Cellular adds a SIM and a larger power budget you did not ask for.",
        D: "Radio is the switch to make if the hotspot stops reaching the mast.",
      },
    );
  }

  return finish(
    "B",
    [
      ...classic.blockers,
      rs
        ? "The PortABC base is the one specified for that: rain stays on Grove, quick-connect on Port A, RS-485 on Ports B and C (up to three). Firmware for the anemometer and the soil probe is not finished."
        : "The PortABC base keeps rain on Grove, quick-connect on Port A, and Qwiic on Port B.",
      "Power is a wall plug or a 6–10 W solar panel.",
    ],
    portsFor("B", answers),
    CONFIGS.B.power,
    `${CONFIGS.B.base} (${CONFIGS.B.baseCost})`,
    CONFIGS.B.baseCents,
    false,
    false,
    {
      A: `The classic build cannot carry this list. ${classic.blockers[0] ?? ""}`.trim(),
      B: "",
      C: "Add cellular only if the hotspot fails at the mast. It costs more power.",
      D: "LoRa replaces Wi-Fi when stations should relay on their own. Pair-to-pair needs no gateway.",
    },
  );
}

function portsFor(
  id: Exclude<ConfigId, "E">,
  answers: Answers,
  poeBase = false,
): string[] {
  const rain = has(answers, "rain");
  const rs = rs485Count(answers);
  const qwiic = qwiicCount(answers) > 0;

  if (id === "A") {
    return [
      rain
        ? "Grove on the Atom Lite: Hydreon RG15 rain gauge."
        : rs
          ? "Grove serial on the Atom Lite: the one RS-485 sensor, through an RS-485 adapter. The rain gauge cannot share this port."
          : "Grove on the Atom Lite: free in this build.",
      qwiic
        ? "Qwiic chain on the GPIO header, up to eight parts."
        : "No Qwiic chain in this build.",
      poeBase
        ? "PoE base (W5500) underneath. It takes the extension spot."
        : "No PoE base. Power the Atom Lite from USB.",
      rs
        ? "RS-485: one device, on the Grove serial port. A second RS-485 sensor, or rain together with RS-485, needs the PortABC base."
        : "RS-485: one device at most (Grove serial), and only without the PoE base or a rain gauge.",
    ];
  }

  if (id === "B") {
    return [
      "Grove on the Atom Lite: Hydreon RG15. This first version keeps rain there.",
      "Port A: quick-connect devices.",
      rs
        ? "Ports B and C: RS-485 for wind and soil. This base allows up to three RS-485 devices."
        : "Ports B and C: spare RS-485. Use them later without replanning the orb.",
      qwiic
        ? "Qwiic: use Port B only when that port is not holding RS-485. Otherwise keep the chain off the RS-485 ports."
        : "Qwiic: none selected. Port B can take a chain later if it is free of RS-485.",
    ];
  }

  const shared =
    rs >= 2 && qwiic
      ? "Port A is busy: both RS-485 devices need native plus Port A. Keep the Qwiic chain on the microcontroller Grove side, with the rain gauge."
      : qwiic
        ? "Qwiic: microcontroller Grove or Port A."
        : "Qwiic: none selected.";
  return [
    rain
      ? "Grove on the Atom Lite: Hydreon RG15."
      : "Grove on the Atom Lite: open for a Grove part or a short Qwiic lead.",
    "RS-485: the native port plus Port A, two devices maximum.",
    shared,
    id === "D"
      ? "Radio base is US915 LoRaWAN hardware. Pair-to-pair does not require a gateway or a LoRaWAN network."
      : "The NB-IoT base needs a SIM activated before you seal the housing.",
  ];
}

export function knownAddonCents(answers: Answers, baseCents: number): number {
  const n = answers.count ?? 1;
  let cents = baseCents * n;
  if (has(answers, "wind")) cents += 6200 * n;
  if (has(answers, "soil")) cents += 2990 * n;
  return cents;
}

export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
