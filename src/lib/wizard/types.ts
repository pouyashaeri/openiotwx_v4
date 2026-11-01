export type Intent = "community" | "watch" | "teach" | "bench";
export type PlaceId = "indoors" | "home" | "farm" | "urban" | "edge" | "rural" | "extreme";
export type PowerId = "outlet" | "solar";
export type LinkId = "cell" | "wifi" | "poe" | "lora" | "ham";
export type MeasureId =
  | "air"
  | "rain"
  | "wind"
  | "soil"
  | "pm"
  | "co2"
  | "ozone"
  | "sun";
export type CountId = 1 | 3 | 6;
export type SurpriseId =
  | "water"
  | "heat"
  | "air"
  | "fire"
  | "storm"
  | "dry"
  | "power"
  | "picture";
export type WhoId = "neighbors" | "school" | "land" | "coordinators" | "partners";
export type ProgressId = "trust" | "ours" | "checklist" | "backup" | "practice";
export type GapId = "nomeasure" | "control" | "owner" | "siting" | "upkeep";
/** What the people around the station can bring to the build and to the data. New in v3. */
export type ResourceId = "printer" | "parts" | "hands" | "compute" | "host" | "funds";
/** Where readings live. Each option is more open than the one before it. New in v3. */
export type SharingId = "local" | "community" | "open";
export type ConfigId = "A" | "B" | "C" | "D" | "E";
export type StepId =
  | "place"
  | "link"
  | "measures"
  | "count"
  | "surprises"
  | "people"
  | "resources"
  | "data"
  | "review";

/** A point on the map. The label is whatever the person typed or picked (a town, a ZIP, a corner). */
export type SiteLocation = {
  lat: number | null;
  lon: number | null;
  label: string;
};

export type Answers = {
  intent: Intent | null;
  place: PlaceId | null;
  power: PowerId | null;
  link: LinkId | null;
  measures: MeasureId[];
  sharp: boolean;
  count: CountId | null;
  surprises: SurpriseId[];
  who: WhoId[];
  progress: ProgressId[];
  gaps: GapId[];
  resources: ResourceId[];
  sharing: SharingId | null;
  /** Explicit opt-in to archive and publish readings in GDEX. Off until someone turns it on. */
  gdex: boolean;
  location: SiteLocation;
};

export type Goal = { id: string; text: string };

export type GoalChange = {
  id: string;
  at: string;
  from: string;
  to: string;
  why: string;
};

export function blankLocation(): SiteLocation {
  return { lat: null, lon: null, label: "" };
}

export function blankAnswers(): Answers {
  return {
    intent: null,
    place: null,
    power: null,
    link: null,
    measures: [],
    sharp: false,
    count: null,
    surprises: [],
    who: [],
    progress: [],
    gaps: [],
    resources: [],
    sharing: null,
    gdex: false,
    location: blankLocation(),
  };
}

export function hasLocation(location: SiteLocation | undefined | null): location is SiteLocation & {
  lat: number;
  lon: number;
} {
  return Boolean(
    location &&
      typeof location.lat === "number" &&
      typeof location.lon === "number" &&
      Number.isFinite(location.lat) &&
      Number.isFinite(location.lon),
  );
}
