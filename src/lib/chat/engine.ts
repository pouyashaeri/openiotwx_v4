import { blankAnswers, type Answers } from "../wizard/types.ts";
import { isSkip, matchMulti, matchSingle, mentionsExtremes, parseSelection } from "./keywords.ts";
import { FIELDS, FIELD_BY_KEY, type FieldKey, type FieldSpec } from "./spec.ts";

/**
 * The conversation is driven by this file, not by the language model. The model only reads one
 * free-text answer and says which of our existing choices it matches. This code checks every
 * value against the wizard's own choice lists, decides the next question, and writes the same
 * answers the step-by-step wizard writes. A small or confused model cannot leave the decision tree.
 */

export type ChatState = {
  answers: Answers;
  siteName: string;
  /** Optional questions the person chose to skip. */
  skipped: FieldKey[];
};

export function initialState(): ChatState {
  return { answers: blankAnswers(), siteName: "", skipped: [] };
}

/** What a model (or the keyword fallback) found in one message. Already validated. */
export type Extraction = {
  intent?: string;
  place?: string;
  power?: string;
  link?: string;
  count?: 1 | 3 | 6;
  measures?: string[];
  surprises?: string[];
  who?: string[];
  progress?: string[];
  gaps?: string[];
  sharp?: boolean;
  /** Ids to leave out of the list being asked about ("all of them except ..."). */
  exclude?: string[];
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

const SINGLE_KEYS = ["intent", "place", "power", "link"] as const;
const MULTI_KEYS = ["measures", "surprises", "who", "progress", "gaps"] as const;

function allowed(key: FieldKey): Set<string> {
  return new Set(FIELD_BY_KEY[key].options.map((option) => String(option.id)));
}

function bucketCount(value: unknown): 1 | 3 | 6 | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return null;
  if (n === 1) return 1;
  return n <= 4 ? 3 : 6;
}

/** Keep only values that exist in the wizard's own choice lists. Everything else is dropped. */
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
  if (source.sharp === true) out.sharp = true;
  if (Array.isArray(source.exclude)) {
    const ids = source.exclude.filter((item): item is string => typeof item === "string");
    if (ids.length) out.exclude = [...new Set(ids)];
  }
  return out;
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
  if (field.kind === "text")
    return state.siteName.trim() !== "" || state.skipped.includes(field.key);
  if (field.kind === "multi") {
    const list = state.answers[field.key as (typeof MULTI_KEYS)[number]];
    return list.length > 0 || state.skipped.includes(field.key);
  }
  return state.answers[field.key as "intent" | "place" | "power" | "link" | "count"] != null;
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
      const id = state.answers[field.key as "intent" | "place" | "power" | "link" | "count"];
      if (id != null) value = titleOf(field.key, id);
    } else if (field.kind === "multi") {
      const ids = state.answers[field.key as (typeof MULTI_KEYS)[number]] as string[];
      value =
        ids.length > 1 && ids.length === field.options.length
          ? `All of them (${ids.length})`
          : ids.map((id) => titleOf(field.key, id)).join(", ");
    } else {
      value = state.siteName.trim();
    }
    if (value) rows.push({ key: field.key, label: field.label, value });
  }
  if (state.answers.sharp)
    rows.push({ key: "measures", label: "Extremes", value: "Temperatures swing hard" });
  return rows;
}

function merge(state: ChatState, found: Extraction, currentKey: FieldKey | null) {
  const answers: Answers = { ...state.answers };
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
  if (found.sharp) answers.sharp = true;
  return { state: { ...state, answers }, understood };
}

export type Turn = {
  state: ChatState;
  reply: string;
  /** Fields this message filled in. */
  understood: FieldKey[];
  /** True when a language model, not the keyword fallback, read the message. */
  usedModel: boolean;
  /** The question now being asked, or null when everything is answered. */
  asking: FieldSpec | null;
};

const DONE_TEXT =
  "That is everything I need. Here is what I have. Tell me if anything looks wrong, or press Write my plan.";

function acknowledge(state: ChatState, understood: FieldKey[]): string {
  const rows = summarize(state).filter(
    (row) => understood.includes(row.key) && row.label !== "Extremes",
  );
  if (!rows.length) return "";
  return `Got it. ${rows.map((row) => `${row.label}: ${row.value}`).join(". ")}.`;
}

export async function handleUserMessage(
  state: ChatState,
  message: string,
  extract?: Extractor,
): Promise<Turn> {
  const text = message.trim().slice(0, 600);
  const current = nextField(state);

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
  // Nothing from the model? Give the plain keyword match one chance at the current question.
  if (Object.keys(found).length === 0) found = keywordExtraction(current, text);

  found = applySelectionWording(current, text, found);

  const merged = merge(state, found, current?.key ?? null);
  if (merged.understood.length === 0) {
    return {
      state,
      understood: [],
      usedModel,
      asking: current,
      reply: current
        ? `I was not sure how to match that. ${current.question} You can also tap one of the choices below.`
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
  const tail = asking ? asking.question : DONE_TEXT;
  return { state, understood, usedModel, asking, reply: [lead, tail].filter(Boolean).join(" ") };
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
      "Hi! I will ask a few short questions about your station, then write a draft plan. Answer in your own words. " +
      (asking?.question ?? ""),
  };
}
