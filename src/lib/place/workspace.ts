import { useEffect, useState } from "react";

export type ComputePath = "browser" | "boinc" | "cirrus";

export type WorkspacePrefs = {
  broker: string;
  topic: string;
  database: string;
  gdex: boolean;
  compute: ComputePath;
  joined: boolean;
};

const KEY = "openiotwx-v3";

const BLANK: WorkspacePrefs = {
  broker: "",
  topic: "measurements/iotwx",
  database: "openiotwx",
  gdex: false,
  compute: "browser",
  joined: false,
};

export type PrintJob = {
  id: string;
  part: string;
  status: "needed" | "printing" | "done";
};

export type Offer = {
  id: string;
  who: string;
  place: string;
  has: string;
  note: string;
  mine?: boolean;
};

const SEED_OFFERS: Offer[] = [
  {
    id: "seed-harbor",
    who: "Harbor library lab",
    place: "Coastal town",
    has: "Ender 3, two rolls of PETG",
    note: "Can print caps and the rain-gauge base on weeknights.",
  },
  {
    id: "seed-mesa",
    who: "Mesa makers",
    place: "High desert",
    has: "Spare Grove cables and one RG15 mount",
    note: "Will trade a printed orb for filament.",
  },
  {
    id: "seed-campus",
    who: "Campus sensing club",
    place: "College town",
    has: "Prusa, Atom Lite, Qwiic cables",
    note: "Helps classes flash a first station.",
  },
];

type Collective = {
  jobs: PrintJob[];
  offers: Offer[];
};

const COLLECTIVE_KEY = "openiotwx-collective";

function readPrefs(): WorkspacePrefs {
  if (typeof localStorage === "undefined") return BLANK;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return BLANK;
    return { ...BLANK, ...(JSON.parse(raw) as Partial<WorkspacePrefs>) };
  } catch {
    return BLANK;
  }
}

export function useWorkspace() {
  const [prefs, setPrefs] = useState<WorkspacePrefs>(BLANK);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setPrefs(readPrefs());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs, ready]);
  return { prefs, setPrefs, ready };
}

function readCollective(): Collective {
  if (typeof localStorage === "undefined") return { jobs: [], offers: [] };
  try {
    const raw = localStorage.getItem(COLLECTIVE_KEY);
    if (!raw) return { jobs: [], offers: [] };
    const parsed = JSON.parse(raw) as Partial<Collective>;
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      offers: Array.isArray(parsed.offers) ? parsed.offers : [],
    };
  } catch {
    return { jobs: [], offers: [] };
  }
}

export function useCollective() {
  const [data, setData] = useState<Collective>({ jobs: [], offers: [] });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setData(readCollective());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(COLLECTIVE_KEY, JSON.stringify(data));
  }, [data, ready]);
  return {
    ready,
    jobs: data.jobs,
    offers: [...SEED_OFFERS, ...data.offers],
    mine: data.offers,
    addJob: (part: string) =>
      setData((current) => ({
        ...current,
        jobs: [...current.jobs, { id: `job-${Date.now()}`, part, status: "needed" }],
      })),
    setJob: (id: string, status: PrintJob["status"]) =>
      setData((current) => ({
        ...current,
        jobs: current.jobs.map((job) => (job.id === id ? { ...job, status } : job)),
      })),
    addOffer: (offer: Omit<Offer, "id" | "mine">) =>
      setData((current) => ({
        ...current,
        offers: [...current.offers, { ...offer, id: `offer-${Date.now()}`, mine: true }],
      })),
  };
}
