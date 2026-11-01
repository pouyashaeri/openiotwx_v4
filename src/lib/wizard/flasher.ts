import { CONFIGS } from "./catalog.ts";
import { flashHref, type DraftPlan } from "./plan.ts";

export type FlasherDevice = "esp32" | "rp2040";

export type FlashPath = {
  device: FlasherDevice;
  /** Short name of the board the browser flasher will program. */
  board: string;
  /** One sentence tying the board back to what the person chose in the questionnaire. */
  why: string;
  /** Link to the static flasher, carrying the board and link so the right path is preselected. */
  href: string;
  /** Things to have in hand before pressing the button. */
  bring: string[];
  /** A caveat worth showing next to the button, when the flasher does not cover everything in the plan. */
  note?: string;
  /** What happens in the two flasher steps, in the order the person sees them. */
  steps: { title: string; body: string }[];
};

export const FLASHER_ROOT = `${import.meta.env.BASE_URL}flash-wizard/index.html`;

type FlashLink = "wifi" | "poe" | "cell" | "lora";

function whyFor(link: FlashLink): string {
  switch (link) {
    case "wifi":
      return "You chose Wi-Fi, so the flasher takes you down the Atom Lite path.";
    case "cell":
      return "You chose a cellular SIM, so the flasher takes you down the Atom Lite path, and the NB-IoT base carries the SIM.";
    case "poe":
      return "You chose a network cable that also powers the station, so the flasher takes you down the Atom Lite path, set to Ethernet / PoE.";
    case "lora":
      return "You chose radio between stations, so the flasher takes you down the Atom Lite path, and the LoRaWAN base carries the radio.";
  }
}

/**
 * Which flasher path a plan leads to, or null when nothing can be flashed yet.
 *
 * Every buildable configuration (A–D) is the M5Stack Atom Lite; the base decides the link.
 * v3 sent the radio build to the Feather RP2040. The current configuration sheet uses the Atom
 * Lite for it too, so the RP2040 path stays only for stations already in the field (the flasher
 * still offers it, but a plan never leads there). The long-haul experiment (E) has no board.
 */
export function flashPathFor(plan: DraftPlan): FlashPath | null {
  const href = flashHref(plan);
  const rec = plan.recommendation;
  if (!href || !rec) return null;
  const link = (new URL(href, "http://x").searchParams.get("link") ?? "wifi") as FlashLink;
  const cfg = CONFIGS[rec.configId];

  return {
    device: "esp32",
    board: "M5Stack Atom Lite (ESP32)",
    why: whyFor(link),
    href: `${FLASHER_ROOT}${href.slice(href.indexOf("?"))}`,
    note:
      link === "cell"
        ? "The flasher's form has Wi-Fi and Ethernet fields only. It has no cellular or SIM settings, so it configures the Wi-Fi side of this station. Activate the SIM separately."
        : link === "lora"
          ? "The stations talk to a Raspberry Pi gateway over radio. Flash the stations here, then set the gateway up from its own guide."
          : undefined,
    bring: [
      `The Atom Lite${rec.includePoeBase || link !== "wifi" ? ` with its base attached (${cfg.base})` : ""}`,
      "A USB-C cable that carries data, not only power",
      "Chrome or Edge on a computer (the flasher needs Web Serial)",
      link === "poe"
        ? "The MQTT broker address and a topic for this station"
        : link === "lora"
          ? "The LoRa settings for your region and a topic for this station"
          : "The Wi-Fi name and password, the MQTT broker address, and a topic",
    ],
    steps: [
      {
        title: "Configure",
        body: "Name the station, set the network and broker. Advanced timing has working defaults.",
      },
      {
        title: "Flash",
        body: "Plug in the Atom Lite and the browser writes the firmware and your settings in one go.",
      },
    ],
  };
}
