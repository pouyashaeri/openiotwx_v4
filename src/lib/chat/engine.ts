import { blankAnswers, hasLocation, type Answers } from "../wizard/types.ts";
import { isSkip, matchMulti, matchSingle, matchYesNo, mentionsExtremes, onlyMissing, parseSelection, readSupport, type SupportRead } from "./keywords.ts";
import { FIELDS, FIELD_BY_KEY, askText, type FieldKey, type FieldSpec } from "./spec.ts";

/**
 * The conversation is driven by this file, not by the language model. The model only reads one
 * free-text answer and says which of our existing choices it matches. This code checks every
 * value against the survey's own choice lists, decides the next question, and writes the same
 * answers the step-by-step survey writes. A small or confused model cannot leave the decision tree.
 */

export type ChatState = {
  answers: Answers;
  siteName: string;
  /** Optional questions the person chose to skip. */
  skipped: FieldKey[];
  /** On/off questions (and others with no value of their own) that have been answered. */
  settled: FieldKey[];
};

export function initialState(): ChatState {
  return { answers: blankAnswers(), siteName: "", skipped: [], settled: [] };
}

/** What a model (or the keyword fallback) found in one message. Already validated. */
export type Extraction = {
  intent?: string;
  place?: string;
  power?: string;
  link?: string;
  sharing?: string;
  count?: 1 | 3 | 6;
  measures?: string[];
  surprises?: string[];
  who?: string[];
  progress?: string[];
  gaps?: string[];
  resources?: string[];
  sharp?: boolean;
  gdex?: boolean;
  /** Ids to leave out of the list being asked about ("all of them except ..."). */
  exclude?: string[];
  /** The model judged that this message is not an answer but a request for help. */
  topic?: "support";
};

/**
 * Asks a model to read `message`. Returns raw model output to be validated, or null when no model
 * could be reached, in which case keyword matching is used instead.
 */
export type Extractor = (request: {
  current: FieldSpec | null;
  message: string;
  state: ChatState;
}) => Promise<unknown | null>;

/** Turns a place the person typed into coordinates. The chat widget passes the survey's own lookup. */
export type Locator = (query: string) => Promise<{ lat: number; lon: number; label: string } | null>;

const SINGLE_KEYS = ["intent", "place", "power", "link", "sharing"] as const;
const MULTI_KEYS = ["measures", "surprises", "who", "progress", "gaps", "resources"] as const;
const TOGGLE_KEYS = ["sharp", "gdex"] as const;

function allowed(key: FieldKey): Set<string> {
  return new Set(FIELD_BY_KEY[key].options.map((option) => String(option.id)));
}

function bucketCount(value: unknown): 1 | 3 | 6 | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return null;
  if (n === 1) return 1;
  return n <= 4 ? 3 : 6;
}

/** Keep only values that exist in the survey's own choice lists. Everything else is dropped. */
export function validateExtraction(raw: unknown): Extraction {
  const out: Extraction = {};
  if (!raw || typeof raw !== "object") return out;
  // Models sometimes nest the fields under "answers".
  const source = (
    "answers" in raw && raw.answers && typeof raw.answers === "object" ? raw.answers : raw
  ) as Record<string, unknown>;

  for (const key of SINGLE_KEYS) {
    const value = source[key];
    if (typeof value === "string" && allowed(key).has(value)) out[key] = value;
  }
  for (const key of MULTI_KEYS) {
    const value = source[key];
    const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    const ok = list.filter(
      (item): item is string => typeof item === "string" && allowed(key).has(item),
    );
    if (ok.length) out[key] = [...new Set(ok)];
  }
  const count = bucketCount(source.count);
  if (count) out.count = count;
  for (const key of TOGGLE_KEYS) {
    const value = source[key];
    if (value === true || value === false) out[key] = value;
  }
  if (Array.isArray(source.exclude)) {
    const ids = source.exclude.filter((item): item is string => typeof item === "string");
    if (ids.length) out.exclude = [...new Set(ids)];
  }
  if (source.topic === "support") out.topic = "support";
  return out;
}

/**
 * A small model sometimes fills in fields nobody mentioned. The question being asked is taken from the
 * model as it is; an answer to any other question is kept only when the person's own words agree with it.
 * When the message reads like a problem, everything must agree, so it goes to support instead of into the plan.
 */
function onlyWhatWasSaid(found: Extraction, current: FieldSpec | null, message: string, problem: boolean): Extraction {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(found)) {
    if (key === "siteName" || key === "location") continue;
    if (key === "exclude") {
      out[key] = value;
      continue;
    }
    // A message that reads like a problem is not trusted even for the question asked, unless the words agree.
    if (current && key === current.key && !problem) {
      // A one-choice question: a choice the words only mention as missing ("no outlet") is not picked.
      // Lists are left to the include/exclude reading in applySelectionWording.
      if (Array.isArray(value) || !onlyMissing(current.key, String(value), message)) out[key] = value;
      continue;
    }
    const field = FIELD_BY_KEY[key as FieldKey];
    if (!field) continue;
    if (field.kind === "multi") {
      const said = matchMulti(field.key, message);
      const agreed = (value as string[]).filter((id) => said.includes(id));
      if (agreed.length) out[key] = agreed;
    } else if (field.kind === "toggle") {
      if (matchYesNo(message) === value) out[key] = value;
    } else if (matchSingle(field.key, message) === value) {
      out[key] = value;
    }
  }
  return out as Extraction;
}

function keywordExtraction(current: FieldSpec | null, message: string): Extraction {
  if (!current) return {};
  const out: Extraction = {};
  if (current.kind === "single") {
    const hit = matchSingle(current.key, message);
    if (hit === null) return {};
    if (current.key === "count") out.count = hit as 1 | 3 | 6;
    else (out as Record<string, unknown>)[current.key] = hit;
  } else if (current.kind === "multi") {
    const hits = matchMulti(current.key, parseSelection(current.key, message).includeText);
    if (hits.length) (out as Record<string, unknown>)[current.key] = hits;
    if (current.key === "measures" && mentionsExtremes(message)) out.sharp = true;
  } else if (current.kind === "toggle") {
    const answer = matchYesNo(message);
    if (answer !== null) (out as Record<string, unknown>)[current.key] = answer;
  }
  return out;
}

/** Every choice id for a field, in list order. */
export function allIds(key: FieldKey): string[] {
  return FIELD_BY_KEY[key].options.map((option) => String(option.id));
}

/**
 * Applies "all of them" and "all except ..." to a multiple-choice answer. This is done in code from
 * the person's own words, on top of whatever the model or the keywords found, so a small model that
 * handles negation badly still gives the right list.
 */
function applySelectionWording(
  current: FieldSpec | null,
  text: string,
  found: Extraction,
): Extraction {
  const { exclude: modelExclude, ...rest } = found;
  if (!current || current.kind !== "multi") return rest;
  const key = current.key as (typeof MULTI_KEYS)[number];
  const wording = parseSelection(key, text);
  const options = new Set(allIds(key));
  const excluded = new Set(
    [...wording.exclude, ...(modelExclude ?? [])].filter((id) => options.has(id)),
  );
  let list: string[] = rest[key] ?? [];
  if (wording.all) list = allIds(key);
  else if (list.length === 0 && excluded.size > 0) list = allIds(key);
  list = list.filter((id) => !excluded.has(id));
  const next: Extraction = { ...rest };
  if (list.length) next[key] = list;
  else delete next[key];
  return next;
}

/** Tapping several choice chips and pressing Send. Same result as typing them. */
export function applySelection(state: ChatState, key: FieldKey, ids: string[]): Turn {
  const field = FIELD_BY_KEY[key];
  const valid = ids.filter((id) => field.options.some((option) => String(option.id) === id));
  const found: Extraction = {};
  if (field.kind === "multi") {
    if (valid.length) (found as Record<string, unknown>)[key] = valid;
  } else if (field.kind === "toggle") {
    if (valid[0]) (found as Record<string, unknown>)[key] = valid[0] === "yes";
  } else if (key === "count") {
    const size = bucketCount(Number(valid[0]));
    if (size) found.count = size;
  } else if (valid[0]) (found as Record<string, unknown>)[key] = valid[0];
  const merged = merge(state, found, key);
  if (merged.understood.length === 0) {
    return {
      state,
      understood: [],
      usedModel: false,
      asking: nextField(state),
      reply: "Pick at least one choice first.",
    };
  }
  return finish(
    merged.state,
    merged.understood,
    acknowledge(merged.state, merged.understood),
    false,
  );
}

export function applicableFields(state: ChatState): FieldSpec[] {
  const bench = state.answers.intent === "bench";
  return FIELDS.filter((field) => !(field.communityOnly && bench));
}

function isFilled(state: ChatState, field: FieldSpec): boolean {
  if (field.kind === "text") return state.siteName.trim() !== "" || state.skipped.includes(field.key);
  if (field.kind === "location") return hasLocation(state.answers.location) || state.skipped.includes(field.key);
  if (field.kind === "toggle") return state.settled.includes(field.key);
  if (field.kind === "multi") {
    const list = state.answers[field.key as (typeof MULTI_KEYS)[number]];
    return list.length > 0 || state.skipped.includes(field.key);
  }
  return state.answers[field.key as (typeof SINGLE_KEYS)[number] | "count"] != null;
}

/** The next unanswered question, or null when the plan can be written. */
export function nextField(state: ChatState): FieldSpec | null {
  return applicableFields(state).find((field) => !isFilled(state, field)) ?? null;
}

function titleOf(key: FieldKey, id: string | number): string {
  return (
    FIELD_BY_KEY[key].options.find((option) => String(option.id) === String(id))?.title ??
    String(id)
  );
}

/** One readable line per answered field, for the recap and for the plan hand-off. */
export function summarize(
  state: ChatState,
): Array<{ key: FieldKey; label: string; value: string }> {
  const rows: Array<{ key: FieldKey; label: string; value: string }> = [];
  for (const field of applicableFields(state)) {
    let value = "";
    if (field.kind === "single") {
      const id = state.answers[field.key as (typeof SINGLE_KEYS)[number] | "count"];
      if (id != null) value = titleOf(field.key, id);
    } else if (field.kind === "multi") {
      const ids = state.answers[field.key as (typeof MULTI_KEYS)[number]] as string[];
      value =
        ids.length > 1 && ids.length === field.options.length
          ? `All of them (${ids.length})`
          : ids.map((id) => titleOf(field.key, id)).join(", ");
    } else if (field.kind === "toggle") {
      if (field.key === "sharp" && state.answers.sharp) value = "Temperatures swing hard";
      if (field.key === "gdex" && state.answers.gdex) value = "Archive and publish in GDEX";
    } else if (field.kind === "location") {
      value = hasLocation(state.answers.location) ? state.answers.location.label : state.answers.location.label.trim();
    } else {
      value = state.siteName.trim();
    }
    if (value) rows.push({ key: field.key, label: field.label, value });
  }
  return rows;
}

function merge(state: ChatState, found: Extraction, currentKey: FieldKey | null) {
  const answers: Answers = { ...state.answers };
  const settled = [...state.settled];
  const understood: FieldKey[] = [];
  for (const key of SINGLE_KEYS) {
    const value = found[key];
    if (value) {
      (answers as Record<string, unknown>)[key] = value;
      understood.push(key);
    }
  }
  if (found.count) {
    answers.count = found.count;
    understood.push("count");
  }
  for (const key of MULTI_KEYS) {
    const value = found[key];
    if (!value || value.length === 0) continue;
    // Answering the question just asked replaces the list; mentioning it in passing adds to it.
    answers[key] = (
      key === currentKey ? value : [...new Set([...answers[key], ...value])]
    ) as never;
    understood.push(key);
  }
  for (const key of TOGGLE_KEYS) {
    const value = found[key];
    if (value === undefined) continue;
    // Mentioning extremes while answering something else turns it on; an unprompted "no" is not an answer.
    if (value === false && currentKey !== key) continue;
    answers[key] = value;
    if (!settled.includes(key)) settled.push(key);
    understood.push(key);
  }
  return { state: { ...state, answers, settled }, understood };
}

/** A message that belongs with a person: the chat hands it to the contact form. */
export type Handoff = { topic: SupportRead["topic"]; message: string };

export type Turn = {
  state: ChatState;
  reply: string;
  /** Fields this message filled in. */
  understood: FieldKey[];
  /** True when a language model, not the keyword fallback, read the message. */
  usedModel: boolean;
  /** The question now being asked, or null when everything is answered. */
  asking: FieldSpec | null;
  /** Set when the message was a problem or a request for a person, not an answer. */
  handoff?: Handoff;
};

const DONE_TEXT =
  "That is everything I need. Here is what I have. Tell me if anything looks wrong, or press Write my plan.";

function acknowledge(state: ChatState, understood: FieldKey[]): string {
  const rows = summarize(state).filter((row) => understood.includes(row.key));
  if (!rows.length) return "";
  return `Got it. ${rows.map((row) => `${row.label}: ${row.value}`).join(". ")}.`;
}

function handoffTurn(state: ChatState, current: FieldSpec | null, text: string, read: SupportRead, usedModel: boolean): Turn {
  const back = current ? `\nWhen you are ready, we carry on with the plan:\n${askText(current, state.answers.intent)}` : "";
  return {
    state,
    understood: [],
    usedModel,
    asking: current,
    handoff: { topic: read.topic, message: text.slice(0, 600) },
    reply: `That sounds like something a person should look at, not the planning chat. You can write to support and a person will answer. Your place in the plan is kept.${back}`,
  };
}

export async function handleUserMessage(
  state: ChatState,
  message: string,
  extract?: Extractor,
  locate?: Locator,
): Promise<Turn> {
  const text = message.trim().slice(0, 600);
  const current = nextField(state);
  const support = readSupport(text);

  // Someone who asks for a person gets one, whatever the question was.
  if (support.explicit) return handoffTurn(state, current, text, support, false);

  // The place's name is free text. No model needed.
  if (current?.key === "siteName") {
    const skip = isSkip(text);
    const next: ChatState = skip
      ? { ...state, skipped: [...state.skipped, "siteName"] }
      : { ...state, siteName: text.slice(0, 60) };
    return finish(
      next,
      skip ? [] : ["siteName"],
      skip ? "No problem. I will use a generic name." : "",
      false,
    );
  }

  // Where it is: the survey's own lookup turns it into a point.
  if (current?.key === "location") {
    if (isSkip(text)) {
      return finish({ ...state, skipped: [...state.skipped, "location"] }, [], "No problem. You can set it later in the plan.", false);
    }
    const hit = locate ? await locate(text).catch(() => null) : { lat: null, lon: null, label: text.slice(0, 80) };
    if (!hit) {
      return {
        state,
        understood: [],
        usedModel: false,
        asking: current,
        reply: "I could not find that place. Try a town, a ZIP, a corner, or coordinates like 40.015, -105.27, or say skip.",
      };
    }
    const next: ChatState = { ...state, answers: { ...state.answers, location: hit as Answers["location"] } };
    return finish(next, ["location"], acknowledge(next, ["location"]), false);
  }

  if (current?.skippable && isSkip(text)) {
    const next: ChatState = { ...state, skipped: [...state.skipped, current.key] };
    return finish(next, [], "No problem, skipping that one.", false);
  }

  let usedModel = false;
  let found: Extraction = {};
  if (extract) {
    try {
      const raw = await extract({ current, message: text, state });
      if (raw !== null) {
        found = validateExtraction(raw);
        usedModel = Object.keys(found).length > 0;
      }
    } catch {
      // A model that errors out is treated like no model at all.
    }
  }
  const modelSaidSupport = found.topic === "support";
  delete found.topic;
  found = onlyWhatWasSaid(found, current, text, support.problem);
  // Nothing from the model? Give the plain keyword match one chance at the current question.
  if (Object.keys(found).length === 0) found = keywordExtraction(current, text);

  found = applySelectionWording(current, text, found);

  const merged = merge(state, found, current?.key ?? null);
  if (merged.understood.length === 0) {
    // Not an answer. If it reads like a problem or a question for a person, hand it over.
    if (modelSaidSupport || support.problem) return handoffTurn(state, current, text, support, usedModel);
    return {
      state,
      understood: [],
      usedModel,
      asking: current,
      reply: current
        ? `I was not sure how to match that. ${askText(current, state.answers.intent)}\nYou can also tap one of the choices below.`
        : "I did not catch a change there. Press Write my plan when you are ready.",
    };
  }
  return finish(
    merged.state,
    merged.understood,
    acknowledge(merged.state, merged.understood),
    usedModel,
  );
}

function finish(state: ChatState, understood: FieldKey[], lead: string, usedModel: boolean): Turn {
  const asking = nextField(state);
  const tail = asking ? askText(asking, state.answers.intent) : DONE_TEXT;
  return { state, understood, usedModel, asking, reply: [lead, tail].filter(Boolean).join("\n") };
}

/** The first message of a new conversation. */
export function openingTurn(): Turn {
  const asking = nextField(initialState());
  return {
    state: initialState(),
    understood: [],
    usedModel: false,
    asking,
    reply:
      "Hi! Let's plan your station together.\n" +
      (asking ? askText(asking, null) : ""),
  };
}
