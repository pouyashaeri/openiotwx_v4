import type {
  ConfigId,
  CountId,
  GapId,
  Intent,
  LinkId,
  MeasureId,
  PlaceId,
  PowerId,
  ProgressId,
  ResourceId,
  SharingId,
  SurpriseId,
  WhoId,
} from "./types";

export type Choice<T extends string | number> = {
  id: T;
  title: string;
  body: string;
  icon: string;
};

export const INTENTS: Choice<Intent>[] = [
  {
    id: "community",
    title: "A place and the people there",
    body: "A neighborhood, a campus, a coast, a town. You want a station and a first plan people can share.",
    icon: "users",
  },
  {
    id: "watch",
    title: "One site I look after",
    body: "A home, a building, a field, a road. Start with what that site has to live with.",
    icon: "home",
  },
  {
    id: "teach",
    title: "A class or a lab",
    body: "Students should leave with a build they understand and a short list of what to do next.",
    icon: "school",
  },
  {
    id: "bench",
    title: "I want to build one and learn",
    body: "Parts, print time, and the flashing checklist. Skip the community plan.",
    icon: "hammer",
  },
];

export const PLACES: Choice<PlaceId>[] = [
  {
    id: "indoors",
    title: "Indoors, inside a building",
    body: "A classroom, lab, office, workshop, or any room where the air inside matters.",
    icon: "building",
  },
  {
    id: "home",
    title: "In, around, or near my home",
    body: "A yard, porch, balcony, roof, or the side of the house.",
    icon: "home",
  },
  {
    id: "farm",
    title: "In, around, or near my garden, farm, or livestock",
    body: "Garden beds, fields, orchards, barns, or pasture.",
    icon: "sprout",
  },
  {
    id: "urban",
    title: "Around town",
    body: "A street, rooftop, school grounds, campus, or park.",
    icon: "sign",
  },
  {
    id: "edge",
    title: "On the edge of town",
    body: "A road, shelter, or lot just outside the built-up area.",
    icon: "trees",
  },
  {
    id: "rural",
    title: "Out in the countryside",
    body: "A trail, ridge, field, or other spot that is a drive from the nearest building.",
    icon: "mountain",
  },
  {
    id: "extreme",
    title: "Somewhere remote or hard to reach",
    body: "A mountain, shoreline, or wilderness site. Getting there takes real effort.",
    icon: "mountain",
  },
];

export const POWERS: Choice<PowerId>[] = [
  {
    id: "outlet",
    title: "A wall outlet nearby",
    body: "The station plugs in with a USB power adapter.",
    icon: "plug",
  },
  {
    id: "solar",
    title: "A solar panel",
    body: "There is no outlet at the spot, so a solar panel keeps the station running.",
    icon: "sun",
  },
];

export const LINKS: Choice<LinkId>[] = [
  {
    id: "cell",
    title: "Cellular service",
    body: "Mobile phone coverage reaches the spot. The station uses a data SIM, like a phone does.",
    icon: "signal",
  },
  {
    id: "wifi",
    title: "Wi-Fi",
    body: "You can connect to a Wi-Fi network right where the station will sit.",
    icon: "wifi",
  },
  {
    id: "poe",
    title: "A wired network (LAN)",
    body: "A network cable (Ethernet) runs to the spot. It can often carry power too.",
    icon: "cable",
  },
  {
    id: "lora",
    title: "None of these are available where I want to place it",
    body: "No cell service, Wi-Fi, or network cable at the spot. We will work out another way for the station to report in.",
    icon: "pin",
  },
];

export const MEASURES: Choice<MeasureId>[] = [
  {
    id: "air",
    title: "Air: temperature and humidity",
    body: "The basic weather picture, including air pressure.",
    icon: "thermo",
  },
  {
    id: "rain",
    title: "Rainfall",
    body: "How much rain falls at the site.",
    icon: "rain",
  },
  {
    id: "wind",
    title: "Wind",
    body: "Wind speed and direction. The sensor is chosen, but its software is still being finished.",
    icon: "wind",
  },
  {
    id: "soil",
    title: "Soil moisture",
    body: "How wet or dry the ground is, for beds, fields, or a levee. The software for this sensor is still being finished.",
    icon: "sprout",
  },
  {
    id: "pm",
    title: "Air quality",
    body: "Fine dust and smoke in the air. Useful when the air itself is what people notice.",
    icon: "haze",
  },
  {
    id: "co2",
    title: "Carbon dioxide",
    body: "A room, a classroom, or a shelter where stale air matters.",
    icon: "gauge",
  },
  {
    id: "ozone",
    title: "Ozone",
    body: "An outdoor gas reading for days when the air feels sharp.",
    icon: "sun",
  },
  {
    id: "sun",
    title: "Sunlight and UV",
    body: "How bright it is, with a UV reading beside it.",
    icon: "rays",
  },
];

export const COUNTS: Choice<CountId>[] = [
  {
    id: 1,
    title: "One station",
    body: "Learn the build, or keep an eye on a single site.",
    icon: "one",
  },
  {
    id: 3,
    title: "A handful",
    body: "Three stations. Enough to compare a roof, a street, and a low spot.",
    icon: "few",
  },
  {
    id: 6,
    title: "A small network",
    body: "Six stations. Someone has to keep the checklist, not just the hardware.",
    icon: "many",
  },
];

export const SURPRISES: Choice<SurpriseId>[] = [
  {
    id: "water",
    title: "Water where it causes trouble",
    body: "Flooding, a low street, a roof, a culvert that surprises people.",
    icon: "rain",
  },
  {
    id: "heat",
    title: "Heat that wears people down",
    body: "Afternoons that stay hot, or rooms that do not cool overnight.",
    icon: "thermo",
  },
  {
    id: "air",
    title: "Air that feels wrong",
    body: "Smoke, dust, exhaust, or a shelter that goes stale.",
    icon: "haze",
  },
  {
    id: "fire",
    title: "Wildfire season",
    body: "Smoke days, dry fuels, red-flag wind, or an evacuation route people worry about.",
    icon: "flame",
  },
  {
    id: "storm",
    title: "Wind and storms",
    body: "Gusts, a loose roof, or gear that has to stay tied down.",
    icon: "wind",
  },
  {
    id: "dry",
    title: "Dry ground",
    body: "Gardens, fields, or soils that fail before anyone agrees they are dry.",
    icon: "sprout",
  },
  {
    id: "power",
    title: "Power or contact drops out",
    body: "The measurement only helps if the station can still be heard.",
    icon: "battery",
  },
  {
    id: "picture",
    title: "No shared picture yet",
    body: "People swap stories. Nobody has a reading from this place.",
    icon: "users",
  },
];

export const WHO: Choice<WhoId>[] = [
  {
    id: "neighbors",
    title: "Households and neighbors",
    body: "People who live with the station, not only the person who built it.",
    icon: "home",
  },
  {
    id: "school",
    title: "A school or youth group",
    body: "A class that can keep the checklist between semesters.",
    icon: "school",
  },
  {
    id: "land",
    title: "People who grow or steward land",
    body: "A farm, a garden, a restoration site, a shoreline.",
    icon: "sprout",
  },
  {
    id: "coordinators",
    title: "People who step in when something breaks",
    body: "The folks neighbors already call. They need a one-page version.",
    icon: "clipboard",
  },
  {
    id: "partners",
    title: "A lab, agency, or partner",
    body: "Useful, as long as the community can still decide what is shared.",
    icon: "building",
  },
];

export const PROGRESS: Choice<ProgressId>[] = [
  {
    id: "trust",
    title: "A station people trust",
    body: "The numbers look sane, and someone knows who to ask when they do not.",
    icon: "check",
  },
  {
    id: "ours",
    title: "Readings we can see, on our terms",
    body: "A dashboard or a download that does not require giving the data away.",
    icon: "shield",
  },
  {
    id: "checklist",
    title: "A one-page checklist",
    body: "Short enough to follow on a bad day, not only on build day.",
    icon: "clipboard",
  },
  {
    id: "backup",
    title: "A backup if the first site fails",
    body: "Another mount, another host, or a second station already named.",
    icon: "home",
  },
  {
    id: "practice",
    title: "We have tried the plan once",
    body: "A date on the calendar before anyone actually needs it.",
    icon: "flag",
  },
];

export const GAPS: Choice<GapId>[] = [
  {
    id: "nomeasure",
    title: "No local measurements yet",
    body: "The first useful thing is a station that really runs.",
    icon: "gauge",
  },
  {
    id: "control",
    title: "Data exists, but it is not ours",
    body: "Someone else holds the record. This place cannot reuse it.",
    icon: "shield",
  },
  {
    id: "owner",
    title: "Nobody is clearly responsible",
    body: "Hardware fails quietly when everyone assumes someone else looks.",
    icon: "users",
  },
  {
    id: "siting",
    title: "We are not sure where it should live",
    body: "Permission, shade, flooding, and who can visit it are still open.",
    icon: "pin",
  },
  {
    id: "upkeep",
    title: "Building is easier than keeping it running",
    body: "The plan should budget a monthly look, not only a weekend build.",
    icon: "wrench",
  },
];

// Asked after the people step. Each answer unlocks something concrete on the Community page:
// a printer or spare parts joins the build collective, a computer joins the forecast pool,
// a host becomes the place the community server runs.
export const RESOURCES: Choice<ResourceId>[] = [
  {
    id: "printer",
    title: "A 3D printer we can use",
    body: "Yours, a library's, a school's. Housings take hours, not skill.",
    icon: "printer",
  },
  {
    id: "parts",
    title: "Spare OpenIoTwx parts",
    body: "A board, a base, a sensor, or printed housings from a past build that could go to someone else.",
    icon: "box",
  },
  {
    id: "hands",
    title: "People for a build day",
    body: "Two or three people and a Saturday. Enough to click a station together and mount it.",
    icon: "users",
  },
  {
    id: "compute",
    title: "A computer that can stay on",
    body: "A desktop or laptop that is idle most of the day can run forecast work for the community.",
    icon: "cpu",
  },
  {
    id: "host",
    title: "Somewhere to run a small server",
    body: "A Raspberry Pi, an old PC, or a cloud account. This is where readings and dashboards live.",
    icon: "server",
  },
  {
    id: "funds",
    title: "A small budget",
    body: "A grant, a PTA line, or a jar. Enough for boards and filament, not for a contractor.",
    icon: "wallet",
  },
];

export const SHARING: Choice<SharingId>[] = [
  {
    id: "local",
    title: "Keep readings on our own server",
    body: "A broker and database the community runs. Nothing leaves unless someone decides it should.",
    icon: "shield",
  },
  {
    id: "community",
    title: "Share with the OpenIoTwx community",
    body: "Readings appear on the shared map and can be compared with nearby stations. Owners stay named.",
    icon: "users",
  },
  {
    id: "open",
    title: "Publish as open data",
    body: "Readings are archived as analytics-ready data others can cite. GDEX publishing is a separate opt-in below.",
    icon: "globe",
  },
];

/** NSF NCAR and UCAR tools the plan can connect to, in the words a community would use. */
export const TOOLS = {
  credit: {
    name: "CREDIT",
    what: "AI weather prediction from NSF NCAR. Runs a forecast for the exact spot your station stands on.",
    url: "https://github.com/NCAR/miles-credit",
  },
  gdex: {
    name: "GDEX",
    what: "NSF NCAR's archive for analytics-ready data. A place your readings can live after the project.",
    url: "https://gdex.ucar.edu/",
  },
  cirrus: {
    name: "CIRRUS",
    what: "NCAR's cloud platform. The same services you run on a Raspberry Pi can run there when the network grows.",
    url: "https://github.com/NCAR/mesonet-siparcs25",
  },
  metabase: {
    name: "Metabase",
    what: "Open dashboards over your own database. Plots, questions, and alerts without writing code.",
    url: "https://www.metabase.com/",
  },
  boinc: {
    name: "BOINC",
    what: "Volunteer computing. Idle computers in the community share the forecast work.",
    url: "https://boinc.berkeley.edu/",
  },
  ipfs: {
    name: "IPFS",
    what: "Content-addressed storage. Forecast and archive files are pinned by more than one machine.",
    url: "https://github.com/ipfs/ipfs",
  },
  ejscreen: {
    name: "EJScreen / EJAM",
    what: "Environmental justice indicators for any point, maintained by Public Environmental Data Partners.",
    url: "https://ejanalysis.com/status",
  },
  svi: {
    name: "CDC/ATSDR SVI",
    what: "The Social Vulnerability Index: 16 census factors in four themes, ranked for every tract.",
    url: "https://www.arcgis.com/home/item.html?id=900ac955b1134049906e9de6d97aa44a",
  },
} as const;

export type ConfigSpec = {
  id: ConfigId;
  name: string;
  tag: string;
  mcu: string;
  comms: string;
  base: string;
  baseCost: string;
  baseCents: number;
  power: string;
  places: string;
};

export const CONFIGS: Record<ConfigId, ConfigSpec> = {
  A: {
    id: "A",
    name: "Classic building drop",
    tag: "Wi-Fi, optional PoE",
    mcu: "M5Stack Atom Lite (ESP32)",
    comms: "Wi-Fi 4/5 through an external hotspot, or PoE when the W5500 base is fitted",
    base: "M5Stack PoE base (W5500), only if you are using the cable for power",
    baseCost: "$18.50",
    baseCents: 1850,
    power: "Power over Ethernet, or USB from a wall plug if you skip the PoE base",
    places: "Urban, simple sensor list",
  },
  B: {
    id: "B",
    name: "Neighborhood Wi-Fi",
    tag: "Portable sensor mix",
    mcu: "M5Stack Atom Lite (ESP32)",
    comms: "Wi-Fi 4/5 through an external hotspot",
    base: "M5Stack PortABC + Seeed RS-485 Grove",
    baseCost: "$9.09",
    baseCents: 909,
    power: "Wall plug or a 6–10 W solar panel",
    places: "Urban, when the sensor list gets longer",
  },
  C: {
    id: "C",
    name: "Edge cellular",
    tag: "Wi-Fi plus NB-IoT",
    mcu: "M5Stack Atom Lite (ESP32)",
    comms: "Wi-Fi 4/5, plus an internal NB-IoT SIM",
    base: "M5Stack DTU NB-IoT2 v1.1",
    baseCost: "$17.90",
    baseCents: 1790,
    power: "Wall plug or a 20 W solar panel",
    places: "Urban, suburban, semi-rural",
  },
  D: {
    id: "D",
    name: "Radio link",
    tag: "LoRa, pair or LoRaWAN",
    mcu: "M5Stack Atom Lite (ESP32)",
    comms: "LoRa. Pair-to-pair needs no gateway. LoRaWAN if you add one later.",
    base: "M5Stack DTU LoRaWAN base, US915",
    baseCost: "$22.90",
    baseCents: 2290,
    power: "About 10 W of solar",
    places: "Rural, remote, and town sites that should hear each other",
  },
  E: {
    id: "E",
    name: "Long-haul experiment",
    tag: "Not ready to build",
    mcu: "Board still to be chosen",
    comms: "Amateur radio, WSPR/APRS, 1.8–30 MHz",
    base: "No base specified yet",
    baseCost: "n/a",
    baseCents: 0,
    power: "About 20 W of solar, once a board exists",
    places: "Extreme remote only",
  },
};

export const DOCS = {
  home: "https://ncar.github.io/openiotwx/",
  guide: "https://ncar.github.io/openiotwx/guide/",
  print: "https://ncar.github.io/openiotwx/print/",
  flash: "https://ncar.github.io/openiotwx/installation/core_install/",
  assemble: "https://ncar.github.io/openiotwx/assemble/core/",
  data: "https://ncar.github.io/openiotwx/data_management/",
  platform: "https://ncar.github.io/openiotwx/introduction/platform/",
  ideals: "https://ncar.github.io/openiotwx/introduction/ideals/",
  contribute: "https://ncar.github.io/openiotwx/contribution/",
  firmware: "https://github.com/NCAR/esp32-atomlite-arduino-iotwx",
  firmwareZip: "https://github.com/NCAR/esp32-atomlite-arduino-iotwx/archive/refs/heads/master.zip",
  stl: "https://github.com/NCAR/openiotwx-stl/tree/main/housing",
  stlZip: "https://github.com/NCAR/openiotwx-stl/archive/refs/heads/main.zip",
} as const;

export function intentLabel(id: Intent): string {
  return INTENTS.find((item) => item.id === id)?.title ?? id;
}

export function placeLabel(id: PlaceId): string {
  return PLACES.find((item) => item.id === id)?.title ?? id;
}

export function resourceLabel(id: ResourceId): string {
  return RESOURCES.find((item) => item.id === id)?.title ?? id;
}

export function sharingLabel(id: SharingId): string {
  return SHARING.find((item) => item.id === id)?.title ?? id;
}

export function linkLabel(id: LinkId): string {
  if (id === "ham") return "Amateur radio, later experiment";
  return LINKS.find((item) => item.id === id)?.title ?? id;
}

export function powerLabel(id: PowerId): string {
  return POWERS.find((item) => item.id === id)?.title ?? id;
}
