import type { ComputePath } from "./workspace";

/** Where a forecast would run. Shared by the Forecast page and step 4 (Track and Forecast). */
export const COMPUTE_PATHS: { id: ComputePath; title: string; body: string }[] = [
  {
    id: "browser",
    title: "This browser",
    body: "A local stand-in so you can see history, now, and the next day before any model account exists.",
  },
  {
    id: "boinc",
    title: "Volunteer computers",
    body: "BOINC shares the job across machines people already own. Use it when the forecast should not depend on one lab server.",
  },
  {
    id: "cirrus",
    title: "NCAR CIRRUS",
    body: "The Mesonet example runs CREDIT on CIRRUS and reads the result in Metabase. Choose this when the community has that path.",
  },
];
