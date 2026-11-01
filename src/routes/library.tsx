import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CONFIGS, DOCS, TOOLS } from "@/lib/wizard/catalog";
import { PURPOSES } from "@/lib/wizard/purpose";
import type { ConfigId } from "@/lib/wizard/types";

export const Route = createFileRoute("/library")({
  head: () => ({ meta: [{ title: "Field library — OpenIoTwx" }] }),
  component: LibraryPage,
});

const ORDER: ConfigId[] = ["A", "B", "C", "D", "E"];

function LibraryPage() {
  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-sm text-kelp-deep">Field library</p>
      <h1 className="mt-2 font-display text-4xl sm:text-5xl">Manuals, ports, and the two generations.</h1>
      <p className="mt-4 text-muted">
        The wizard is the front door. This page keeps the older build knowledge: what to print,
        how to flash, and which stations already in the field should stay on their original
        firmware.
      </p>
      <p className="no-print mt-6">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center rounded-full bg-kelp px-5 text-sm text-paper"
        >
          Start from a place
        </Link>
      </p>

      <section className="mt-8 rounded-2xl border border-line bg-card p-5">
        <h2 className="font-display text-2xl">Download the files</h2>
        <p className="mt-2 text-sm text-muted">
          NCAR has not published a numbered release. These zips are the current main branch: every
          housing STL, and the Atom Lite source you flash from the Arduino IDE. Individual STLs
          also sit on the print page if you only need one part.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <a
            href={DOCS.stlZip}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-5 text-sm font-medium text-white hover:bg-brand-deep"
          >
            Download STL zip
          </a>
          <a
            href={DOCS.firmwareZip}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-white px-5 text-sm hover:border-brand"
          >
            Download Atom Lite source
          </a>
        </div>
      </section>

      <Section title="Why the questions exist">
        <p>
          OpenIoTwx plans are built on four ideas: risk, fragility, resilience, and preparedness.
          The wizard never asks you to rate those words. It asks what the place has lived through,
          what is in the way, who would act, and what you will write down before you need it.
        </p>
        <ul className="mt-4 grid gap-3">
          {PURPOSES.map((item) => (
            <li key={item.id} className="rounded-2xl border border-line bg-card px-4 py-3">
              <p className="text-sm text-kelp-deep">{item.term}</p>
              <p className="font-display text-xl">{item.plain}</p>
              <p className="mt-1 text-sm text-muted">{item.guide}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 max-w-full overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="py-2 pr-3 font-medium">Idea</th>
                <th className="py-2 pr-3 font-medium">In a house</th>
                <th className="py-2 font-medium">For a station</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line">
                <td className="py-2 pr-3">What could happen</td>
                <td className="py-2 pr-3">A storm, a fire, a burst pipe</td>
                <td className="py-2">Flooding, heat, bad air, wind, dry ground</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2 pr-3">How ready you are</td>
                <td className="py-2 pr-3">An old roof, one road out</td>
                <td className="py-2">No local reading, a weak link, no one responsible</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2 pr-3">How you respond and recover</td>
                <td className="py-2 pr-3">Who you call, where you stay</td>
                <td className="py-2">A steward, a backup mast, one practice run</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">What you set up in advance</td>
                <td className="py-2 pr-3">Insurance, a bag, a backup address</td>
                <td className="py-2">A checklist, parts on order, a date on the calendar</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Two boards, on purpose">
        <p>
          New plans use the M5Stack Atom Lite (ESP32). One firmware image is the direction of the
          software: Wi-Fi, cellular, and LoRa selected in a configuration file when the matching
          base is attached. The first version does not try every port permutation.
        </p>
        <p className="mt-3">
          The RP2040 build is the legacy station. Keep it for hardware already deployed and for
          data those stations are already collecting. Do not treat a new recommendation as a
          reason to abandon that firmware. Classic flashing and assembly notes on the existing
          site still apply to field repairs.
        </p>
      </Section>

      <Section title="Order of work">
        <ol className="grid gap-2 text-sm">
          {[
            "Read the guide once, including the parts you think you can skip.",
            "Decide the station with the wizard, not by scanning a spreadsheet.",
            "Download the print files and start the long parts first.",
            "Order the Atom Lite, the base, and only the sensors the plan names.",
            "Flash the board and upload config.json with the filesystem tool.",
            "Activate a SIM now if the plan is cellular.",
            "Bench-test what the firmware already supports.",
            "Assemble, cap unused ports, and only then go to the site.",
          ].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="font-display text-lg text-kelp tabular-nums">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Configurations">
        <div className="grid gap-3">
          {ORDER.map((id) => {
            const cfg = CONFIGS[id];
            return (
              <article key={id} className="rounded-2xl border border-line bg-card px-4 py-4">
                <p className="text-sm text-kelp-deep">
                  {id === "E" ? "Later" : `Configuration ${id}`}
                </p>
                <h3 className="font-display text-2xl">{cfg.name}</h3>
                <p className="text-sm text-muted">{cfg.tag}</p>
                <dl className="mt-3 grid gap-2 text-sm">
                  <Row term="Board" detail={cfg.mcu} />
                  <Row term="Link" detail={cfg.comms} />
                  <Row term="Base" detail={`${cfg.base}${cfg.baseCents ? ` · ${cfg.baseCost}` : ""}`} />
                  <Row term="Power" detail={cfg.power} />
                  <Row term="Where it fits" detail={cfg.places} />
                </dl>
              </article>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-muted">
          LoRa can run pair-to-pair with no gateway and no LoRaWAN network. The listed radio base
          is US915. Wind (SENTEC WS302, about $62) and the DFRobot soil probe (about $29.90) are
          on the wiring sheet, and their firmware is not finished.
        </p>
      </Section>

      <Section title="First-version ports">
        <ul className="grid gap-2 text-sm">
          <li className="rounded-xl bg-paper-deep px-3 py-2">
            Grove on the Atom Lite: Hydreon RG15 rain gauge.
          </li>
          <li className="rounded-xl bg-paper-deep px-3 py-2">
            Port A: quick-connect devices. On the cellular and LoRa bases, Port A is also the
            second RS-485 port.
          </li>
          <li className="rounded-xl bg-paper-deep px-3 py-2">
            Ports B and C, Wi-Fi PortABC base: flexible RS-485, up to three devices including Port
            A.
          </li>
          <li className="rounded-xl bg-paper-deep px-3 py-2">
            Qwiic: GPIO on the classic drop, up to eight. On the Wi-Fi base, Port B only when it is
            free of RS-485.
          </li>
          <li className="rounded-xl bg-paper-deep px-3 py-2">
            Classic PoE (W5500, $18.50) takes the extension spot. It does not combine with RS-485,
            and rain does not combine with both PoE and a Qwiic chain.
          </li>
        </ul>
      </Section>

      <Section title="Flashing, without the old shortcut">
        <p>
          The board needs a config.json in a data folder: station id, broker, topic, and, for
          Wi-Fi, the network name and password. Flash the sketch, then upload that folder with
          LittleFS (ESP32 Sketch Data Upload). An earlier shortcut uploader was removed because it
          was insecure.
        </p>
        <p className="mt-3">
          If the port will not show, close other serial programs, hold the right boot or reset
          sequence for the board you actually plugged in, and select that device again. Do not
          flash an RP2040 image onto an Atom Lite, or the reverse.
        </p>
        <p className="mt-3 text-sm">
          Board profile used in the classic Atom Lite notes: 115200 baud, 240 MHz, 4 MB flash,
          Huge APP partition, PSRAM off.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-ink px-4 py-4 text-xs leading-relaxed text-paper">{`{
  "iotwx_local_config": "1",
  "iotwx_id": "m5atom/esp32/your-id",
  "iotwx_mq_ip": "",
  "iotwx_mq_port": "1883",
  "iotwx_publish_interval": "1",
  "iotwx_topic": "measurements/iotwx",
  "iotwx_wifi_ssid": "SSID",
  "iotwx_wifi_pwd": "PASSWORD"
}`}</pre>
      </Section>

      <Section title="Sensors by connector">
        <Connector
          name="Qwiic"
          rows={[
            ["Temperature, humidity, pressure, VOC", "BME680 or BME688"],
            ["Temperature, pressure, humidity, sharper", "MS8607"],
            ["Temperature only, extreme range", "TMP119, TMP117, or MCP9808"],
            ["Humidity with temperature", "HDC3022"],
            ["Fine particles", "PMSA3000i"],
            ["Ultraviolet", "LTR390"],
            ["Light", "TSL2591"],
            ["Ozone", "DFRobot SEN0321"],
            ["Carbon dioxide", "SCD40"],
          ]}
        />
        <Connector name="Grove" rows={[["Rain", "Hydreon RG15"]]} />
        <Connector
          name="RS-485"
          rows={[
            ["Wind", "SENTEC WS302 · about $62 · firmware in progress"],
            ["Soil moisture", "DFRobot · about $29.90 · firmware in progress"],
          ]}
        />
        <p className="mt-3 text-sm text-muted">
          MS8607 is the high-precision part that still covers temperature, pressure, and humidity
          together. Several other precise parts only cover one or two of those. If the site is
          extreme and you only need temperature, a TMP117-class sensor can be the better fit.
        </p>
      </Section>

      <Section title="Data stays a choice">
        <p>
          Stations publish MQTT. CHORDS is the documented broker and can also draw the charts. You
          can send readings to a server you run. The public OpenIoTwx feed is an option, not a
          condition. Communities that have had data used against them do not owe a public archive.
        </p>
        <p className="mt-3">
          The questions in the wizard came out of planning with communities who needed both a
          station and a way to act on it. The draft plan is there so the hardware does not arrive
          before anyone has agreed who looks, what stays private, and what happens if the first
          site fails.
        </p>
      </Section>

      <Section title="Open manuals">
        <ul className="grid gap-2 text-sm">
          <Doc href={DOCS.guide} label="How to follow the build" />
          <Doc href={DOCS.platform} label="Platform: orb, 1 inch thread, up to seven nodes" />
          <Doc href={DOCS.stlZip} label="Download every STL (zip)" />
          <Doc href={DOCS.print} label="Print settings and one-file STLs" />
          <Doc href={DOCS.stl} label="Browse housings on GitHub" />
          <Doc href={DOCS.firmwareZip} label="Download Atom Lite source (zip)" />
          <Doc href={DOCS.assemble} label="Assemble the core unit" />
          <Doc href={DOCS.data} label="Data management" />
          <Doc href={DOCS.ideals} label="Project ideals" />
          <Doc href={DOCS.contribute} label="Contribute a housing, a sensor, or a field note" />
        </ul>
      </Section>

      <Section title="Version 3: the stack behind the station">
        <p>
          The wizard now ends in a running system, not only a checklist. Everything below ships in the{" "}
          <code>infra/</code> folder of this repository and runs with one <code>docker compose up</code>; the same
          containers deploy to NCAR CIRRUS with the helm chart.
        </p>
        <dl className="mt-4 grid gap-3">
          {(Object.keys(TOOLS) as Array<keyof typeof TOOLS>).map((key) => {
            const tool = TOOLS[key];
            return (
              <div key={key} className="rounded-lg border border-line bg-panel px-4 py-3">
                <dt className="font-medium">
                  <a className="underline underline-offset-4" href={tool.url}>
                    {tool.name}
                  </a>
                </dt>
                <dd className="mt-1 text-sm text-muted">{tool.what}</dd>
              </div>
            );
          })}
        </dl>
        <ul className="mt-4 grid gap-2 text-sm">
          <Doc href="https://github.com/NCAR/mesonet-siparcs25" label="mesonet-siparcs25: the reference microservice this stack follows" />
          <Doc href="https://www.atsdr.cdc.gov/place-health/php/svi/index.html" label="CDC/ATSDR SVI documentation" />
          <Doc href="https://ejanalysis.com/status" label="EJScreen and EJAM status (Public Environmental Data Partners)" />
          <Doc href="https://boinc.berkeley.edu/" label="BOINC: volunteer computing" />
        </ul>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl">{title}</h2>
      <div className="mt-3 text-pretty">{children}</div>
    </section>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted">{term}</dt>
      <dd>{detail}</dd>
    </div>
  );
}

function Connector({ name, rows }: { name: string; rows: string[][] }) {
  return (
    <div className="mt-4">
      <h3 className="font-display text-xl">{name}</h3>
      <ul className="mt-2 grid gap-2">
        {rows.map((row) => (
          <li key={row[1]} className="grid gap-1 border-b border-line py-2 text-sm sm:grid-cols-2">
            <span>{row[0]}</span>
            <span className="text-muted">{row[1]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Doc({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a className="text-kelp-deep underline underline-offset-4" href={href}>
        {label}
      </a>
    </li>
  );
}
