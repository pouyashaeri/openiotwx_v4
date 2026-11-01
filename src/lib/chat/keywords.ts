import type { FieldKey } from "./spec.ts";

/**
 * Plain keyword matching. This is the fallback when no language model is reachable, and it keeps
 * the chat usable on a static site. It only ever looks at the question that was just asked, so a
 * word like "solar" cannot be read as sunlight when the question was about power.
 *
 * Order matters for single-choice fields: the first pattern that matches wins.
 */
const SINGLE: Partial<Record<FieldKey, Array<[string, RegExp]>>> = {
  intent: [
    ["teach", /\b(class|classroom|students?|teach|teacher|course|lab|school project)\b/i],
    ["bench", /\b(learn|learning|build one|hobby|tinker|myself|bench|diy|for fun)\b/i],
    ["community", /\b(community|neighbou?r\w*|town|campus|people|group|coast|city)\b/i],
    [
      "watch",
      /\b(one site|my (home|house|property|farm|garden|yard|site)|look after|monitor|watch)\b/i,
    ],
  ],
  place: [
    [
      "indoors",
      /\b(indoors?|inside|classroom|office|workshop|room|building|lab|basement|greenhouse)\b/i,
    ],
    [
      "farm",
      /\b(garden|farm|livestock|orchard|barn|pasture|cattle|crops?|field|ranch|vineyard)\b/i,
    ],
    ["home", /\b(home|house|yard|porch|balcony|backyard|apartment)\b/i],
    [
      "extreme",
      /\b(remote|hard to reach|wilderness|mountain|summit|shoreline|arctic|desert|glacier|off.?grid)\b/i,
    ],
    ["rural", /\b(rural|countryside|ridge|trail|valley|far from)\b/i],
    ["edge", /\b(edge of town|outskirts|suburb|just outside|stretch of road)\b/i],
    ["urban", /\b(town|city|street|rooftop|roof|campus|park|downtown|school grounds|urban)\b/i],
  ],
  power: [
    ["solar", /\b(solar|panel|battery|no outlet|no power|off.?grid|sun powered)\b/i],
    ["outlet", /\b(outlet|plug|mains|wall|socket|electric\w*|grid power|usb)\b/i],
  ],
  link: [
    [
      "lora",
      /\b(none|nothing|neither|no (cell|signal|service|coverage|wi-?fi|internet|network|connection)|not available|off.?grid)\b/i,
    ],
    ["poe", /\b(ethernet|lan|wired|network cable|cable|poe)\b/i],
    ["wifi", /\b(wi-?fi|wireless|router|hotspot|wlan)\b/i],
    [
      "cell",
      /\b(cell|cellular|sim|lte|4g|5g|mobile (data|service|coverage)|phone (signal|service|coverage))\b/i,
    ],
  ],
};

const MULTI: Partial<Record<FieldKey, Array<[string, RegExp]>>> = {
  measures: [
    // "air" on its own means the temperature-and-humidity choice. "air quality" is a different one.
    ["air", /\b(air(?!\s+(quality|pollution))|atmosphere|temp\w*|humid\w*|weather|pressure)\b/i],
    ["rain", /\b(rain\w*|precip\w*|downpour)\b/i],
    ["soil", /\b(soil|moisture|irrigat\w*|dry ground)\b/i],
    [
      "pm",
      /\b(air quality|smoke|dust|particulates?|particles?|pm ?2\.?5?|wildfire|pollution|haze)\b/i,
    ],
    ["wind", /\b(wind|gust\w*|breeze)\b/i],
    ["co2", /\b(co2|carbon dioxide|stuffy|stale air|ventilation)\b/i],
    ["ozone", /\b(ozone|smog)\b/i],
    ["sun", /\b(sun|sunlight|uv|brightness|light level|solar radiation)\b/i],
  ],
  surprises: [
    ["water", /\b(flood\w*|water|culvert|low street|puddl\w*)\b/i],
    ["heat", /\b(heat|hot|too warm|scorching|heat wave)\b/i],
    ["air", /\b(smoke|smoky|dust|exhaust|stale|bad air|air feels)\b/i],
    ["fire", /\b(wildfire\w*|fire season|red flag|evacuat\w*|burn scar|brush fire)\b/i],
    ["storm", /\b(storm\w*|wind|gust\w*|hail|tornado|hurricane)\b/i],
    ["dry", /\b(dry|drought|parched)\b/i],
    ["power", /\b(power (cut|out|drop|loss)|blackout|outage|lose power)\b/i],
    ["picture", /\b(no data|no readings|stories|no shared picture|nobody has)\b/i],
  ],
  who: [
    ["neighbors", /\b(neighbou?rs?|household\w*|families|residents|people who live)\b/i],
    ["school", /\b(school|class|students?|youth|teachers?)\b/i],
    ["land", /\b(farm\w*|grow\w*|garden\w*|land|steward\w*|restoration|shoreline|ranch\w*)\b/i],
    ["coordinators", /\b(fix|repair|break|coordinators?|maintain\w*|volunteers?|step in)\b/i],
    ["partners", /\b(lab|agency|partner\w*|university|researchers?|city staff|government)\b/i],
  ],
  progress: [
    ["trust", /\b(trust\w*|reliable|sane|accurate|credible)\b/i],
    ["ours", /\b(dashboard|our terms|control|own (the )?data|download|ours|private)\b/i],
    ["checklist", /\b(checklist|one.?page|instructions|steps)\b/i],
    ["backup", /\b(backup|back.?up|spare|second (site|station)|fallback)\b/i],
    ["practice", /\b(practi[cs]e\w*|rehears\w*|try (it|the plan)|dry run|drill)\b/i],
  ],
  gaps: [
    ["nomeasure", /\b(no (local )?(measurements?|data|readings)|nothing measured|no station)\b/i],
    ["control", /\b(not ours|someone else|can'?t (use|access|reuse)|don'?t own|locked)\b/i],
    ["owner", /\b(nobody|no one|who'?s responsible|responsib\w*|owner\w*|in charge)\b/i],
    ["siting", /\b(where|siting|permission|location|not sure where|which spot)\b/i],
    ["upkeep", /\b(upkeep|keep(ing)? it running|maintenance|maintain|looking after|monthly)\b/i],
  ],
};

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  single: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  few: 3,
  handful: 3,
  several: 6,
  many: 6,
  network: 6,
  dozen: 12,
};

/** Counts are bucketed into the wizard's three sizes: 1, 3, or 6. */
export function matchCount(text: string): 1 | 3 | 6 | null {
  const digit = text.match(/\b(\d{1,3})\b/);
  let n: number | null = digit ? Number(digit[1]) : null;
  if (n === null) {
    for (const word of text.toLowerCase().split(/[^a-z]+/)) {
      if (word in WORD_NUMBERS) {
        n = WORD_NUMBERS[word] ?? null;
        break;
      }
    }
  }
  if (n === null || n < 1) return null;
  if (n === 1) return 1;
  return n <= 4 ? 3 : 6;
}

export function matchSingle(field: FieldKey, text: string): string | number | null {
  if (field === "count") return matchCount(text);
  for (const [id, pattern] of SINGLE[field] ?? []) if (pattern.test(text)) return id;
  return null;
}

export function matchMulti(field: FieldKey, text: string): string[] {
  return (MULTI[field] ?? []).filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
}

// ---- "all of them" and "all of them except ..." --------------------------------------------

/** Wording that means every choice on the list. */
const ALL_WORDS: RegExp[] = [
  /^\s*(all|everything|every ?thing)\b(?!\s+(about|regarding|related|with|to\s+do))/i,
  /\ball\s+of\s+(them|these|it|the\s+above)\b/i,
  /\ball\s+(the\s+)?(above|options|choices|measurements|of\s+the\s+above)\b/i,
  /\b(every|each)\s+(one|of\s+them)\b/i,
  /\b(the\s+whole\s+list|select\s+all|the\s+lot)\b/i,
  /\beverything\b(?!\s+(about|regarding|related|with|to\s+do))/i,
];

/** Words that start a list of things to leave out. */
const STRONG_EXCEPT =
  /\b(except(?:\s+for)?|apart\s+from|other\s+than|excluding|exclude|without|besides|minus|not\s+including|aside\s+from|leav(?:e|ing)\s+out)\b/i;
/** "But" only means "leave out" after "all/everything/anything", or when it is followed by "not". */
const WEAK_EXCEPT = /\bbut\b(?!\s+(also|as\s+well|too|then))/i;

export type Selection = {
  /** The person asked for every choice. */
  all: boolean;
  /** Choices they asked to leave out. */
  exclude: string[];
  /** The part of the message that says what to include, without the "except ..." tail. */
  includeText: string;
};

/**
 * Reads a multiple-choice answer for "all of them", and for "all of them except air and rain".
 * Works on the wording alone, so it does not depend on a model handling negation correctly.
 */
export function parseSelection(field: FieldKey, text: string): Selection {
  let split = text.match(STRONG_EXCEPT);
  if (!split) {
    const weak = text.match(WEAK_EXCEPT);
    if (weak && weak.index !== undefined) {
      const before = text.slice(0, weak.index);
      const after = text.slice(weak.index + weak[0].length);
      const allBefore =
        ALL_WORDS.some((pattern) => pattern.test(before)) || /\banything\b/i.test(before);
      if (allBefore || /^\s*(not|no|never)\b/i.test(after)) split = weak;
    }
  }
  const at = split?.index ?? -1;
  const includeText = split && at >= 0 ? text.slice(0, at) : text;
  const tail = split && at >= 0 ? text.slice(at + split[0].length) : "";
  const exclude = tail ? matchMulti(field, tail) : [];
  const includesNothingNamed = matchMulti(field, includeText).length === 0;
  const all =
    ALL_WORDS.some((pattern) => pattern.test(includeText)) ||
    // "Anything but wind", or just "except wind", means everything else.
    (exclude.length > 0 && (includesNothingNamed || /\banything\b/i.test(includeText)));
  return { all, exclude, includeText };
}

/** "Skip", "none", "not sure"... said on its own, or leading the message. */
export function isSkip(text: string): boolean {
  return /^\s*(skip|pass|none|nothing|no|nope|n\/a|not sure|i don'?t know|dont know|no idea|unsure)\b/i.test(
    text,
  );
}

/** Extreme-temperature wording on the measuring question. */
export function mentionsExtremes(text: string): boolean {
  return /\b(extreme|swing\w*|very (hot|cold)|freez\w*|below zero|scorching|brutal)\b/i.test(text);
}
