import {
  COUNTS,
  GAPS,
  INTENTS,
  LINKS,
  MEASURES,
  PLACES,
  POWERS,
  PROGRESS,
  RESOURCES,
  SHARING,
  SURPRISES,
  WHO,
} from "../wizard/catalog.ts";
import { SURVEY, questionTitle, type SurveyKey } from "../wizard/questions.ts";
import type { Intent } from "../wizard/types.ts";

/**
 * Everything the chat can fill in: the survey's own questions, with the survey's own ids. The chat's
 * wording and choices come from `questions.ts` and `catalog.ts`, the same files the survey page reads, so
 * it asks exactly what the survey asks.
 */
export type FieldKey = SurveyKey;

export type ChatOption = { id: string | number; title: string; hint: string };

export type FieldSpec = {
  key: FieldKey;
  kind: "single" | "multi" | "text" | "toggle" | "location";
  /** The question, exactly as the survey asks it. For one whose wording depends on the answers so far, use `askTitle`. */
  question: string;
  /** The line the survey puts under the question. */
  body: string;
  /** Short label used when the chat repeats an answer back. */
  label: string;
  options: ChatOption[];
  /** The person may say "skip" and the plan is still written. The survey does not require these. */
  skippable: boolean;
  /** Only asked on the community paths, like the survey's community steps. */
  communityOnly: boolean;
};

const opts = (
  list: ReadonlyArray<{ id: string | number; title: string; body: string }>,
): ChatOption[] => list.map((item) => ({ id: item.id, title: item.title, hint: item.body }));

const YES_NO: ChatOption[] = [
  { id: "yes", title: "Yes", hint: "" },
  { id: "no", title: "No", hint: "" },
];

const field = (
  key: FieldKey,
  kind: FieldSpec["kind"],
  label: string,
  options: ChatOption[],
  flags: { skippable?: boolean; communityOnly?: boolean } = {},
): FieldSpec => ({
  key,
  kind,
  label,
  question: questionTitle(key),
  body: SURVEY[key].body,
  options,
  skippable: flags.skippable ?? false,
  communityOnly: flags.communityOnly ?? false,
});

/** In the order the survey asks them. */
export const FIELDS: FieldSpec[] = [
  field("intent", "single", "Path", opts(INTENTS)),
  field("place", "single", "Place", opts(PLACES)),
  field("power", "single", "Power", opts(POWERS)),
  field("link", "single", "Connection", opts(LINKS)),
  field("measures", "multi", "Measuring", opts(MEASURES)),
  field("sharp", "toggle", "Extremes", YES_NO),
  field("count", "single", "Stations", opts(COUNTS)),
  field("surprises", "multi", "Caught people off guard", opts(SURPRISES), { skippable: true, communityOnly: true }),
  field("who", "multi", "Who it is for", opts(WHO), { skippable: true, communityOnly: true }),
  field("progress", "multi", "Better in six months", opts(PROGRESS), { skippable: true, communityOnly: true }),
  field("gaps", "multi", "In the way", opts(GAPS), { skippable: true, communityOnly: true }),
  field("resources", "multi", "On hand", opts(RESOURCES), { skippable: true }),
  field("sharing", "single", "Readings live", opts(SHARING)),
  field("gdex", "toggle", "GDEX", YES_NO),
  field("siteName", "text", "Name", [], { skippable: true }),
  field("location", "location", "Location", [], { skippable: true }),
];

export const FIELD_BY_KEY: Record<FieldKey, FieldSpec> = Object.fromEntries(
  FIELDS.map((f) => [f.key, f]),
) as Record<FieldKey, FieldSpec>;

/** The question's wording for this person (the survey words "surprises" differently on a teaching path). */
export function askTitle(spec: FieldSpec, intent: Intent | null): string {
  return questionTitle(spec.key, intent);
}

/** The question and the line under it, as one message. */
export function askText(spec: FieldSpec, intent: Intent | null): string {
  return `${askTitle(spec, intent)}\n${spec.body}`;
}
