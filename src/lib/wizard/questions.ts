/**
 * The survey's questions, as data: the words each question is asked in, and the short text under it.
 *
 * Both the step-by-step wizard and the planning chat read these, so the chat asks exactly what the
 * survey asks. The choices themselves (their titles and descriptions) already come from catalog.ts for
 * both. Change a question's wording here and it changes in both places.
 */
import { TOOLS } from "./catalog.ts";
import type { Intent } from "./types.ts";

export type SurveyKey =
  | "intent"
  | "place"
  | "power"
  | "link"
  | "measures"
  | "sharp"
  | "count"
  | "surprises"
  | "who"
  | "progress"
  | "gaps"
  | "resources"
  | "sharing"
  | "gdex"
  | "siteName"
  | "location";

export type SurveyText = {
  /** The question, as the survey asks it. */
  title: string | ((intent: Intent | null) => string);
  /** The line under it. */
  body: string;
};

/** Shown in the survey's text boxes as an example, and by the chat under the same question. */
export const NAME_PLACEHOLDER = "North lot, harbor road";
export const LOCATION_PLACEHOLDER = "Boulder, CO or 80302 or 40.015, -105.27";

export const SURVEY: Record<SurveyKey, SurveyText> = {
  intent: {
    title: "What brings you here?",
    body: "Pick the path that matches the work. A bench build skips the community checklist.",
  },
  place: {
    title: "Where will your station be placed?",
    body: "A station is a small sensor box you build and install, indoors or out. Pick the setting closest to yours.",
  },
  power: {
    title: "How will your station be powered?",
    body: "Pick what is really available at the spot, not what you hope to add later.",
  },
  link: {
    title: "What communication technology is available?",
    body: "This is how your station will send its readings. Choose the one that works where you want to place it.",
  },
  measures: {
    title: "What data should your station collect?",
    body: "Choose every community measurement that matters to you. You can drop one later.",
  },
  sharp: {
    title: "Temperatures here swing hard",
    body: "Prefer a sensor that stays accurate in extreme heat or cold. Everyday sensors are simpler and also report volatile organic compounds (VOCs) in the air, which the extreme-weather sensors do not.",
  },
  count: {
    title: "How many stations do you want?",
    body: "Print time and the parts list scale with this number.",
  },
  surprises: {
    title: (intent) => (intent === "teach" ? "What should people be able to notice at your site?" : "What has caught people off guard at your site?"),
    body: "Pick every pattern that is actually true. This is not a score.",
  },
  who: {
    title: "Who needs to be able to use it?",
    body: "Response starts with a person who can open this plan.",
  },
  progress: {
    title: "Six months from now, which of these would matter?",
    body: "How you would recover: a backup, a practice run, readings you still control.",
  },
  gaps: {
    title: "What is in the way right now?",
    body: "How ready you are today. Naming the gap is the point, not a score.",
  },
  resources: {
    title: "What can the people around this station bring?",
    body: "Pick what is really on hand. Each answer unlocks something on the Community page: a printer joins the build collective, a spare computer joins the forecast pool, a host runs the server. Nothing here is required.",
  },
  sharing: {
    title: "Where should the readings live?",
    body: "Each option is more open than the one before it. You can move up or down the list later; the plan records the decision and the date.",
  },
  gdex: {
    title: "Also archive and publish in GDEX",
    body: `${TOOLS.gdex.what} This is an opt-in: off until you turn it on, and reversible. The plan's data section shows exactly what would be published and under which license before anything leaves your server.`,
  },
  siteName: {
    title: "What should we call this place?",
    body: `For example: ${NAME_PLACEHOLDER}.`,
  },
  location: {
    title: "Where is it? A town, a ZIP, a corner, or coordinates.",
    body: `For example: ${LOCATION_PLACEHOLDER}.`,
  },
};

/** The headings the survey puts over a group of questions. */
export const STEPS = {
  /** "Who is your station for" groups three questions: who, progress, gaps. */
  people: {
    title: "Who is your station for, and what would better look like?",
    body: "Three short groups. Choose at least one in each.",
  },
  review: {
    title: "Name the place, then write the plan.",
    body: "You can revise any answer after. Goal posts stay put until you edit them.",
  },
} as const;

export function questionTitle(key: SurveyKey, intent: Intent | null = null): string {
  const t = SURVEY[key].title;
  return typeof t === "function" ? t(intent) : t;
}
