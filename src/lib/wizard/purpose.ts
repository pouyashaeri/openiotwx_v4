import type { StepId } from "./types.ts";

export type PurposeId = "risk" | "fragility" | "resilience" | "preparedness";

export type Purpose = {
  id: PurposeId;
  term: string;
  plain: string;
  guide: string;
};

export const PURPOSES: Purpose[] = [
  {
    id: "risk",
    term: "Risk",
    plain: "What could happen",
    guide: "The trouble this place already knows. A station only helps if it can see that.",
  },
  {
    id: "fragility",
    term: "Fragility",
    plain: "How ready you are",
    guide: "The gap between what could happen and what you can currently see, power, and count on.",
  },
  {
    id: "resilience",
    term: "Resilience",
    plain: "How you respond and recover",
    guide: "Who acts, where the station goes if the first site fails, and whether you have tried it once.",
  },
  {
    id: "preparedness",
    term: "Preparedness",
    plain: "What you set up in advance",
    guide: "The checklist, the parts, and the date you practice. Decided before the day you need them.",
  },
];

export function purposeById(id: PurposeId): Purpose {
  const found = PURPOSES.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown purpose ${id}`);
  return found;
}

const STEP_PURPOSE: Record<StepId, { id: PurposeId; line: string }> = {
  place: {
    id: "risk",
    line: "Where it sits changes what can happen to the station, and whether anyone can reach it afterward.",
  },
  link: {
    id: "fragility",
    line: "A station you cannot hear does not make this place more ready.",
  },
  measures: {
    id: "risk",
    line: "Choose what this place needs you to see. A sensor that ignores the real trouble does not help.",
  },
  count: {
    id: "preparedness",
    line: "How many stations you commit to is part of what you set up before you need them.",
  },
  surprises: {
    id: "risk",
    line: "Start from what has already caught people off guard. That is the list of what could happen.",
  },
  people: {
    id: "resilience",
    line: "Response and recovery are people and a backup, not another part number.",
  },
  resources: {
    id: "resilience",
    line: "What the people around you can bring is how you respond and recover. It is not another part number.",
  },
  data: {
    id: "fragility",
    line: "Readings you cannot reach, or cannot share, leave a place less ready than it looks.",
  },
  review: {
    id: "preparedness",
    line: "The next page is the plan you write ahead of time: parts, actions, and goal posts.",
  },
};

export function stepPurpose(step: StepId): { term: string; plain: string; line: string } {
  const mapped = STEP_PURPOSE[step];
  const purpose = purposeById(mapped.id);
  return { term: purpose.term, plain: purpose.plain, line: mapped.line };
}
