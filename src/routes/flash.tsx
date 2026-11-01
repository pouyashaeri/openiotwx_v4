import { createFileRoute, Link } from "@tanstack/react-router";
import { FlowSteps } from "@/components/flow-steps";
import { DOCS } from "@/lib/wizard/catalog";
import { buildPlan, flashHref, needsRaspberryPi } from "@/lib/wizard/plan";
import { useDraft } from "@/lib/wizard/store";

export const Route = createFileRoute("/flash")({
  head: () => ({ meta: [{ title: "Flash | OpenIoTwx" }] }),
  component: FlashPage,
});

const STEPS = [
  "Install Arduino IDE 1.8, the line that still supports SPIFFS.",
  "Add the ESP32 board package and select the Atom Lite.",
  "Install the IoTwx library and the sensor libraries named in the flashing guide.",
  "Set the Wi-Fi, cellular, or LoRa mode in the configuration file. Do not fork the sketch for each base.",
  "Flash, reboot, and confirm the station publishes before you close the housing.",
];

function FlashPage() {
  const answers = useDraft((state) => state.answers);
  const siteName = useDraft((state) => state.siteName);
  const plan = buildPlan(answers, siteName);
  const planFlash = flashHref(plan);
  const pi = needsRaspberryPi(plan);
  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <FlowSteps current={2} />
      <h1 className="font-display text-4xl sm:text-5xl">Put the firmware on the board</h1>
      <p className="mt-3 text-muted">
        New stations use the Atom Lite. Stations already in the field on the RP2040 stay on the
        classic firmware. One image is the direction: the configuration file selects Wi-Fi,
        cellular, or LoRa when the matching base is attached.
      </p>
      <ol className="mt-8 grid gap-3">
        {STEPS.map((step, index) => (
          <li key={step} className="rounded-2xl border border-line bg-card px-4 py-4">
            <p className="text-sm text-kelp-deep">Step {index + 1}</p>
            <p className="mt-1">{step}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <a
          href={planFlash ?? "/flash-wizard/index.html"}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-kelp px-5 text-sm text-paper transition-[filter] duration-150 not-disabled:hover:brightness-110"
        >
          {planFlash ? "Configure and flash your plan's board" : "Open the browser flasher"}
        </a>
        <a
          href={DOCS.firmwareZip}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-5 text-sm transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep"
        >
          Download Atom Lite source
        </a>
        <a
          href={DOCS.flash}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-5 text-sm transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep"
        >
          Open the flashing guide
        </a>
      </div>
      <div className="mt-8 flex justify-end">
        <Link
          to={pi ? "/raspberry-pi" : "/deploy"}
          search={pi ? undefined : { station: undefined }}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-kelp px-5 text-sm font-medium text-paper transition-[filter] duration-150 not-disabled:hover:brightness-110"
        >
          {pi ? "Next: set up the Raspberry Pi gateway" : "Next: Deploy and Publish"}
        </Link>
      </div>
      <p className="mt-4 text-sm text-muted">
        Wind and soil firmware are still in progress. Flash what the guide already supports, and
        leave those two on the checklist as wiring until their drivers land.
      </p>
    </main>
  );
}
