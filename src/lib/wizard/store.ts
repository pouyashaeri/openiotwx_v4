import { create } from "zustand";
import {
  blankAnswers,
  blankLocation,
  type Answers,
  type Goal,
  type GoalChange,
  type Intent,
  type SiteLocation,
  type StepId,
} from "./types.ts";

// v3 reads a v1/v2 draft once and carries it forward under the new key, so nobody loses a plan
// by opening the new version.
const KEY = "openiotwx-draft-v3";
const LEGACY_KEYS = ["openiotwx-draft-v1"];

export type Persisted = {
  answers: Answers;
  step: StepId;
  checks: Record<string, boolean>;
  goals: Goal[];
  goalLog: GoalChange[];
  goalsTouched: boolean;
  siteName: string;
  startedAt: string;
};

type DraftState = Persisted & {
  hydrated: boolean;
  hydrate: () => void;
  reset: () => void;
  setIntent: (intent: Intent) => void;
  setStep: (step: StepId) => void;
  patchAnswers: (patch: Partial<Answers>) => void;
  toggleMeasure: (id: Answers["measures"][number]) => void;
  toggleList: <K extends "surprises" | "who" | "progress" | "gaps" | "resources">(
    key: K,
    id: Answers[K][number],
  ) => void;
  setSiteName: (siteName: string) => void;
  setLocation: (location: Partial<SiteLocation>) => void;
  setGdex: (gdex: boolean) => void;
  setGoals: (goals: Goal[]) => void;
  toggleCheck: (id: string) => void;
  reviseGoal: (id: string, text: string, why: string) => void;
  markGoalsTouched: () => void;
  loadShared: (data: Persisted) => void;
};

function emptyPersisted(): Persisted {
  return {
    answers: blankAnswers(),
    step: "place",
    checks: {},
    goals: [],
    goalLog: [],
    goalsTouched: false,
    siteName: "",
    startedAt: "",
  };
}

function pick(state: DraftState): Persisted {
  return {
    answers: state.answers,
    step: state.step,
    checks: state.checks,
    goals: state.goals,
    goalLog: state.goalLog,
    goalsTouched: state.goalsTouched,
    siteName: state.siteName,
    startedAt: state.startedAt,
  };
}

function sanitize(raw: unknown): Persisted | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Persisted>;
  if (!value.answers || typeof value.answers !== "object") return null;
  const base = emptyPersisted();
  return {
    ...base,
    ...value,
    // "ham" is no longer offered; drafts saved with it fall back to the no-connection option.
    answers: {
      ...base.answers,
      ...value.answers,
      ...(value.answers.link === "ham" ? { link: "lora" as const } : {}),
      resources: Array.isArray(value.answers.resources) ? value.answers.resources : [],
      location: {
        ...blankLocation(),
        ...(value.answers.location && typeof value.answers.location === "object"
          ? value.answers.location
          : {}),
      },
      gdex: value.answers.gdex === true,
    },
    checks: value.checks ?? {},
    goals: Array.isArray(value.goals) ? value.goals : [],
    goalLog: Array.isArray(value.goalLog) ? value.goalLog : [],
  };
}

export function encodeDraft(data: Persisted): string {
  const json = JSON.stringify({ ...data, checks: {} });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeDraft(payload: string): Persisted | null {
  try {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return sanitize(JSON.parse(json));
  } catch {
    return null;
  }
}

export const useDraft = create<DraftState>((set, get) => ({
  ...emptyPersisted(),
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    if (typeof window === "undefined") {
      set({ hydrated: true });
      return;
    }
    try {
      let raw = window.localStorage.getItem(KEY);
      if (!raw) {
        for (const legacy of LEGACY_KEYS) {
          raw = window.localStorage.getItem(legacy);
          if (raw) break;
        }
      }
      const parsed = raw ? sanitize(JSON.parse(raw)) : null;
      set(parsed ? { ...parsed, hydrated: true } : { hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  reset: () => {
    set({ ...emptyPersisted(), hydrated: true });
  },
  setIntent: (intent) => {
    set({
      answers: { ...get().answers, intent },
      startedAt: get().startedAt || new Date().toISOString(),
    });
  },
  setStep: (step) => set({ step }),
  patchAnswers: (patch) => set({ answers: { ...get().answers, ...patch } }),
  toggleMeasure: (id) => {
    const current = get().answers.measures;
    const measures = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    set({ answers: { ...get().answers, measures } });
  },
  toggleList: (key, id) => {
    const current = get().answers[key] as string[];
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    set({ answers: { ...get().answers, [key]: next } });
  },
  setSiteName: (siteName) => set({ siteName }),
  setLocation: (location) =>
    set({
      answers: {
        ...get().answers,
        location: { ...get().answers.location, ...location },
      },
    }),
  setGdex: (gdex) => set({ answers: { ...get().answers, gdex } }),
  setGoals: (goals) => set({ goals }),
  toggleCheck: (id) => set({ checks: { ...get().checks, [id]: !get().checks[id] } }),
  reviseGoal: (id, text, why) => {
    const current = get().goals.find((goal) => goal.id === id);
    if (!current || current.text === text.trim()) return;
    const change: GoalChange = {
      id: `${id}-${Date.now()}`,
      at: new Date().toISOString().slice(0, 10),
      from: current.text,
      to: text.trim(),
      why: why.trim() || "Updated without a note",
    };
    set({
      goalsTouched: true,
      goals: get().goals.map((goal) => (goal.id === id ? { ...goal, text: text.trim() } : goal)),
      goalLog: [...get().goalLog, change],
    });
  },
  markGoalsTouched: () => set({ goalsTouched: true }),
  loadShared: (data) => {
    set({
      ...data,
      checks: get().checks,
      hydrated: true,
      startedAt: data.startedAt || new Date().toISOString(),
    });
  },
}));

if (typeof window !== "undefined") {
  useDraft.subscribe((state, previous) => {
    if (!state.hydrated || state === previous) return;
    window.localStorage.setItem(KEY, JSON.stringify(pick(state)));
  });
}
