import {
  COUNTS,
  GAPS,
  INTENTS,
  LINKS,
  MEASURES,
  PLACES,
  POWERS,
  PROGRESS,
  SURPRISES,
  WHO,
} from "../wizard/catalog.ts";

/** Everything the chat can fill in. Same fields, same ids as the step-by-step wizard. */
export type FieldKey =
  | "intent"
  | "place"
  | "power"
  | "link"
  | "measures"
  | "count"
  | "surprises"
  | "who"
  | "progress"
  | "gaps"
  | "siteName";

export type ChatOption = { id: string | number; title: string; hint: string };

export type FieldSpec = {
  key: FieldKey;
  kind: "single" | "multi" | "text";
  /** The question as the chat asks it, in plain words. */
  question: string;
  /** Short label used when the chat repeats an answer back. */
  label: string;
  options: ChatOption[];
  /** The person may say "skip" and the plan is still written. */
  skippable: boolean;
  /** Only asked on the community paths, like the wizard's last steps. */
  communityOnly: boolean;
};

const opts = (
  list: ReadonlyArray<{ id: string | number; title: string; body: string }>,
): ChatOption[] => list.map((item) => ({ id: item.id, title: item.title, hint: item.body }));

export const FIELDS: FieldSpec[] = [
  {
    key: "intent",
    kind: "single",
    label: "Path",
    question:
      "What brings you here? For example: a place and the people in it, one site you look after, a class or lab, or building a station to learn.",
    options: opts(INTENTS),
    skippable: false,
    communityOnly: false,
  },
  {
    key: "place",
    kind: "single",
    label: "Place",
    question:
      "Where will your station be placed? Indoors, near your home, around a garden or farm, in town, or somewhere more remote?",
    options: opts(PLACES),
    skippable: false,
    communityOnly: false,
  },
  {
    key: "power",
    kind: "single",
    label: "Power",
    question: "How will your station be powered: a wall outlet nearby, or a solar panel?",
    options: opts(POWERS),
    skippable: false,
    communityOnly: false,
  },
  {
    key: "link",
    kind: "single",
    label: "Connection",
    question:
      "What communication technology is available where you want to place it: cellular service, Wi-Fi, a wired network, or none of these?",
    options: opts(LINKS),
    skippable: false,
    communityOnly: false,
  },
  {
    key: "measures",
    kind: "multi",
    label: "Measuring",
    question:
      "What data should your station collect? For example temperature and humidity, rainfall, soil moisture, air quality, wind, carbon dioxide, ozone, or sunlight.",
    options: opts(MEASURES),
    skippable: false,
    communityOnly: false,
  },
  {
    key: "count",
    kind: "single",
    label: "Stations",
    question:
      "How many stations do you want: one, a handful (about three), or a small network (about six)?",
    options: opts(COUNTS),
    skippable: false,
    communityOnly: false,
  },
  {
    key: "surprises",
    kind: "multi",
    label: "Caught people off guard",
    question:
      'What has caught people off guard at your site? For example flooding, heat, smoky air, storms, dry ground, or power cuts. Say "skip" if nothing comes to mind.',
    options: opts(SURPRISES),
    skippable: true,
    communityOnly: true,
  },
  {
    key: "who",
    kind: "multi",
    label: "Who it is for",
    question:
      'Who needs to be able to use your station? Neighbors, a school, people who work the land, people who fix things when they break, or a lab or agency partner. "Skip" is fine.',
    options: opts(WHO),
    skippable: true,
    communityOnly: true,
  },
  {
    key: "progress",
    kind: "multi",
    label: "Better in six months",
    question:
      "Six months from now, what would matter most? A station people trust, readings you control, a one-page checklist, a backup site, or having practiced the plan once.",
    options: opts(PROGRESS),
    skippable: true,
    communityOnly: true,
  },
  {
    key: "gaps",
    kind: "multi",
    label: "In the way",
    question:
      'What is in the way right now? No measurements yet, data you cannot use, nobody clearly responsible, not sure where to put it, or keeping it running. Or "skip".',
    options: opts(GAPS),
    skippable: true,
    communityOnly: true,
  },
  {
    key: "siteName",
    kind: "text",
    label: "Name",
    question: 'Last one: what should we call this place? Say "skip" and I will use a generic name.',
    options: [],
    skippable: true,
    communityOnly: false,
  },
];

export const FIELD_BY_KEY: Record<FieldKey, FieldSpec> = Object.fromEntries(
  FIELDS.map((field) => [field.key, field]),
) as Record<FieldKey, FieldSpec>;
