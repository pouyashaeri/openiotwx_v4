import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FlowSteps } from "@/components/flow-steps";
import { BonnetFigure, Figure, ImagerFigure, OverviewFigure, TerminalFigure } from "@/components/pi-figures";
import { CopyBlock, btnGhost } from "@/components/platform-ui";
import {
  DEFAULTS,
  DEPLOY_EXPLAINED,
  LOGS,
  REPO_TREE,
  RESTART,
  RUN,
  SERVICE,
  STATUS,
  STOP_FOR_GOOD,
  STOP_NOW,
  UPDATE,
  adaptCommand,
  cloneCommands,
  codeDir,
  sshCommand,
  validBroker,
  validHost,
  validUser,
  writeConfigCommand,
  type PiInput,
} from "@/lib/pi/commands.ts";
import { buildPlan, needsRaspberryPi } from "@/lib/wizard/plan";
import { useDraft } from "@/lib/wizard/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/raspberry-pi")({
  head: () => ({ meta: [{ title: "Raspberry Pi gateway | OpenIoTwx" }] }),
  component: PiPage,
});

const KEY = "openiotwx-pi-guide";

function PiPage() {
  const hydrated = useDraft((s) => s.hydrated);
  const answers = useDraft((s) => s.answers);
  const siteName = useDraft((s) => s.siteName);
  const plan = useMemo(() => buildPlan(answers, siteName), [answers, siteName]);
  if (!hydrated) return <p className="mx-auto max-w-5xl px-4 py-16 text-muted">Opening your plan…</p>;

  // The gateway only exists in LoRa plans. Everyone else gets a plain explanation, not the guide.
  if (!needsRaspberryPi(plan)) {
    return (
      <main id="content" className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="font-display text-4xl">No Raspberry Pi in this plan</h1>
        <p className="mt-3 text-muted">
          {plan.ready
            ? "A Raspberry Pi gateway is part of the radio (LoRa) build, where it listens to the stations and passes their readings on. Your plan uses a different link, so there is nothing to set up here."
            : "The wizard decides this. Finish it and, if your plan uses radio between stations, this guide appears."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to={plan.ready ? "/plan" : "/wizard"} className={btnGhost}>
            {plan.ready ? "Back to your plan" : "Start the wizard"}
          </Link>
        </div>
      </main>
    );
  }
  return <Guide stations={plan.stationCount} />;
}

function readState(): { input: PiInput; done: Record<string, boolean> } {
  const blank = { input: DEFAULTS, done: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return blank;
    const p = JSON.parse(raw) as Partial<{ input: PiInput; done: Record<string, boolean> }>;
    return { input: { ...DEFAULTS, ...p.input }, done: p.done ?? {} };
  } catch {
    return blank;
  }
}

function Guide({ stations }: { stations: number }) {
  const [input, setInput] = useState<PiInput>(DEFAULTS);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const s = readState();
    setInput(s.input);
    setDone(s.done);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ input, done }));
    } catch {
      /* storage unavailable: the guide still works */
    }
  }, [input, done, ready]);

  const errors = {
    user: validUser(input.user) ? null : "Lowercase letters, digits, - and _ only, starting with a letter",
    hostname: validHost(input.hostname) ? null : "Letters, digits and - only",
    broker: validBroker(input.broker) ? null : "A host name or IP address, no spaces",
    port: Number.isInteger(input.port) && input.port > 0 && input.port < 65536 ? null : "1 to 65535",
    topic: /^[\w/{}.-]+$/.test(input.topic) && input.topic.includes("{station_id}") ? null : "Keep {station_id} in the topic",
    edgeId: /^[\w.-]{1,40}$/.test(input.edgeId) ? null : "Letters, digits, . - _ only",
  };
  const valid = Object.values(errors).every((e) => !e);
  // Never put unchecked text into a command someone will paste into a terminal.
  const safe: PiInput = valid ? input : DEFAULTS;
  const adapt = adaptCommand(safe);
  const set = <K extends keyof PiInput>(k: K, v: PiInput[K]) => setInput((cur) => ({ ...cur, [k]: v }));
  const tick = (id: string) => setDone((d) => ({ ...d, [id]: !d[id] }));

  const steps: { id: string; title: string; body: ReactNode; figure?: ReactNode; commands?: { label: string; text: string }[] }[] = [
    {
      id: "os",
      title: "Put the operating system on the memory card",
      figure: (
        <Figure title="Raspberry Pi Imager" caption="Pick the device, Raspberry Pi OS Lite (64-bit) and your card, then open the settings. Your own username and name are filled in from the box above.">
          <ImagerFigure user={safe.user} hostname={safe.hostname} />
        </Figure>
      ),
      body: (
        <>
          <p>
            On any computer, install <strong>Raspberry Pi Imager</strong> from raspberrypi.com/software. Choose your Pi, choose{" "}
            <strong>Raspberry Pi OS Lite (64-bit)</strong>, choose the card, and when it asks to customise, set exactly what is
            drawn: the hostname <code>{safe.hostname}</code>, the username <code>{safe.user}</code> and a password, your Wi-Fi if
            you are not using a cable, and <strong>enable SSH</strong>. Write the card.
          </p>
          <p className="mt-2 text-sm text-muted">
            No desktop is needed. The gateway runs without a screen.
          </p>
        </>
      ),
    },
    {
      id: "attach",
      title: "Attach the LoRa bonnet and the antenna",
      figure: (
        <Figure title="LoRa bonnet on the Pi" caption="Antenna on, Pi off, then press the bonnet down onto the 40-pin header.">
          <BonnetFigure />
        </Figure>
      ),
      body: (
        <>
          <p>
            The code is written for the Adafruit <strong>LoRa Radio Bonnet with OLED, 915 MHz</strong> (RFM95W radio). Screw the
            antenna on before powering anything, because a radio that transmits without one can be damaged. With the Pi
            unplugged, press the bonnet straight onto all 40 pins. Put the card in, plug in a network cable if you are using
            one, then power on and wait about a minute.
          </p>
        </>
      ),
    },
    {
      id: "connect",
      title: "Connect to the Pi from your computer",
      body: (
        <p>
          Open a terminal (Terminal on Mac, PowerShell on Windows) and sign in. The first time it asks whether to trust the
          Pi: type <code>yes</code>, then your password. If the name is not found, look up the Pi's address in your router and use
          that instead.
        </p>
      ),
      commands: [{ label: "On your computer", text: sshCommand(safe) }],
    },
    {
      id: "code",
      title: "Get the gateway code into the right folder",
      body: (
        <>
          <p>
            Everything below runs on the Pi. This downloads NCAR's code to{" "}
            <code>{codeDir(safe.user)}</code>. That exact folder matters: the service looks for it there.
          </p>
          <p className="mt-2 text-sm text-muted">
            The files are in the <code>edge-servers</code> folder of the{" "}
            <a className="text-kelp underline underline-offset-4" href={REPO_TREE}>
              mesonet-siparcs25
            </a>{" "}
            repository: <code>pi_lora.py</code> (the gateway), <code>pi_config.json</code>, <code>setup_and_run.sh</code>,{" "}
            <code>lora-gateway.service</code>, <code>deploy.sh</code> and <code>verify.sh</code>.
          </p>
        </>
      ),
      commands: [{ label: "On the Pi", text: cloneCommands(safe) }],
    },
    {
      id: "adapt",
      title: "Point the scripts at your account",
      body: adapt ? (
        <p>
          NCAR's scripts assume the account is called <code>ncar</code>. Yours is <code>{safe.user}</code>, so this one command
          changes the folder and user in the three files that mention it. Skip it and the service will fail to start.
        </p>
      ) : (
        <p>
          Your account is <code>ncar</code>, the one the scripts were written for, so there is nothing to change. Go to the next
          step.
        </p>
      ),
      commands: adapt ? [{ label: "On the Pi, inside edge-servers", text: adapt }] : [],
    },
    {
      id: "config",
      title: "Say where the readings should go",
      body: (
        <>
          <p>
            <code>pi_config.json</code> tells the gateway which MQTT broker to forward every station's readings to, and gives this
            Pi a name. The values in the box above are written into it. The default broker is NCAR's.
          </p>
          <p className="mt-2 rounded-xl border border-line bg-paper p-3 text-sm text-muted">
            This gateway publishes each reading as JSON to <code>{safe.topic.replace("{station_id}", "<station>")}</code> on that
            broker. When that broker is this site's own (or any broker the site's bridge listens to), enter the gateway's station id on
            the station's page and its readings show up there. With the NCAR default broker they reach NCAR's own services.
          </p>
        </>
      ),
      commands: [{ label: "On the Pi, inside edge-servers", text: writeConfigCommand(safe) }],
    },
    {
      id: "run",
      title: "Start it, and keep it running forever",
      body: (
        <>
          <p>
            One command installs the gateway as a <strong>service</strong>. That is what makes <code>pi_lora.py</code> start by
            itself every time the Pi powers on, and start again 30 seconds after any crash. It keeps going until you stop it on
            purpose. The first start also turns on the Pi's radio and screen interfaces and installs what the code needs, which
            takes a few minutes.
          </p>
          <p className="mt-2 text-sm text-muted">
            If it complains about SPI or I²C on the very first start, reboot the Pi once with <code>sudo reboot</code>. The service
            then starts on its own.
          </p>
        </>
      ),
      commands: [
        { label: "On the Pi, inside edge-servers", text: RUN },
        { label: "What that does (you do not need to type this)", text: DEPLOY_EXPLAINED },
      ],
    },
    {
      id: "verify",
      title: "Check that it works, then prove it survives a restart",
      figure: (
        <Figure title="A healthy gateway" caption="Active (running), the screen and radio found, connected to the broker, and each packet forwarded.">
          <TerminalFigure user={safe.user} hostname={safe.hostname} />
        </Figure>
      ),
      body: (
        <p>
          Look for <strong>active (running)</strong> in the first command, and press <kbd>Ctrl</kbd>+<kbd>C</kbd> to leave the log
          view. Then turn a station on: the log should show it arriving. Finally run <code>sudo reboot</code>, sign in again
          after a minute, and run the status command once more. It should be running without you starting it.
        </p>
      ),
      commands: [
        { label: "Is it running?", text: STATUS },
        { label: "Watch it live", text: LOGS },
      ],
    },
    {
      id: "manage",
      title: "Stop it, restart it, update it",
      body: (
        <p>
          It runs until you tell it otherwise. <em>Stop</em> pauses it until the next reboot. <em>Disable</em> removes it from
          startup for good, so it stays off after reboots too.
        </p>
      ),
      commands: [
        { label: "Stop it for now", text: STOP_NOW },
        { label: "Stop it for good (also off after reboot)", text: STOP_FOR_GOOD },
        { label: "Start it again later", text: `sudo systemctl enable --now ${SERVICE}` },
        { label: "Restart after changing pi_config.json", text: RESTART },
        { label: "Get newer code from NCAR, then restart (inside edge-servers)", text: UPDATE },
      ],
    },
  ];

  const finished = steps.filter((s) => done[s.id]).length;

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <FlowSteps current="pi" />
      <p className="text-sm text-kelp-deep">Gateway for your radio stations</p>
      <h1 className="mt-1 font-display text-4xl sm:text-5xl">Set up the Raspberry Pi</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Your plan uses LoRa radio, so your {stations === 1 ? "station talks" : `${stations} stations talk`} to a Raspberry Pi that
        hears them and passes their readings on over the internet. About 30 minutes, most of it waiting.
      </p>
      <div className="mt-6">
        <Figure title="How the pieces connect" caption="Stations send short radio messages. The Pi hears them and forwards each one to an MQTT broker.">
          <OverviewFigure />
        </Figure>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-card p-5" aria-labelledby="mine">
        <h2 id="mine" className="font-display text-xl">
          Your gateway
        </h2>
        <p className="mt-1 text-sm text-muted">Fill this in once. Every command below updates to match.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Pi username" help="the one you set in Imager" error={errors.user}>
            <input value={input.user} onChange={(e) => set("user", e.target.value.trim())} className="min-h-11 w-full rounded-xl border border-line bg-paper px-3" />
          </Field>
          <Field label="Pi hostname" error={errors.hostname}>
            <input value={input.hostname} onChange={(e) => set("hostname", e.target.value.trim())} className="min-h-11 w-full rounded-xl border border-line bg-paper px-3" />
          </Field>
          <Field label="Gateway name" help="shown in messages" error={errors.edgeId}>
            <input value={input.edgeId} onChange={(e) => set("edgeId", e.target.value.trim())} className="min-h-11 w-full rounded-xl border border-line bg-paper px-3" />
          </Field>
          <Field label="MQTT broker" error={errors.broker}>
            <input value={input.broker} onChange={(e) => set("broker", e.target.value.trim())} className="min-h-11 w-full rounded-xl border border-line bg-paper px-3" />
          </Field>
          <Field label="Broker port" error={errors.port}>
            <input type="number" value={input.port} onChange={(e) => set("port", Number(e.target.value))} className="min-h-11 w-full rounded-xl border border-line bg-paper px-3" />
          </Field>
          <Field label="Topic" error={errors.topic}>
            <input value={input.topic} onChange={(e) => set("topic", e.target.value.trim())} className="min-h-11 w-full rounded-xl border border-line bg-paper px-3" />
          </Field>
        </div>
        {!valid ? (
          <p role="alert" className="mt-3 text-sm text-copper">
            Fix the highlighted boxes. Until then the commands below use the standard values, so nothing unsafe is shown.
          </p>
        ) : null}
        <button type="button" className="mt-3 text-sm text-kelp underline underline-offset-4 transition-colors duration-150 hover:text-kelp-deep" onClick={() => setInput(DEFAULTS)}>
          Reset to NCAR's defaults
        </button>
      </section>

      <p className="mt-8 text-sm text-muted" aria-live="polite">
        {finished} of {steps.length} steps ticked on this device
      </p>
      <ol className="mt-2 grid gap-6">
        {steps.map((s, i) => (
          <li key={s.id} className="rounded-2xl border border-line bg-card p-5">
            <div className="flex items-start gap-3">
              <button
                type="button"
                aria-pressed={Boolean(done[s.id])}
                aria-label={`Mark step ${i + 1} done`}
                onClick={() => tick(s.id)}
                className={cn("mt-1 grid size-7 shrink-0 place-items-center rounded-full border", done[s.id] ? "border-kelp bg-kelp text-paper" : "border-line bg-paper text-kelp-deep")}
              >
                {done[s.id] ? <Check className="size-4" strokeWidth={3} /> : <span className="text-xs font-semibold">{i + 1}</span>}
              </button>
              <div className="min-w-0 flex-1">
                <h2 className={cn("font-display text-2xl", done[s.id] && "text-muted")}>{s.title}</h2>
                <div className="mt-2 grid gap-3 text-sm sm:text-base">{s.body}</div>
                {s.figure ? <div className="mt-4">{s.figure}</div> : null}
                {s.commands?.map((c) => (
                  <CopyBlock key={c.label} label={c.label} text={c.text} />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-10 rounded-2xl border border-line bg-card p-5">
        <h2 className="font-display text-xl">If something is off</h2>
        <dl className="mt-3 grid gap-3 text-sm">
          {[
            ["The service says failed or keeps restarting", `Run ${LOGS} and read the last lines. A wrong username in step 5 and a missing bonnet are the usual causes. It retries every 30 seconds, so fix the cause and wait.`],
            ["“No such file” for the folder", `The code must be at ${codeDir(safe.user)}. Re-do step 4 as the same user you set in Imager.`],
            ["Nothing arrives from the stations", "Check the antenna is on, the stations are powered and set to the same radio frequency (915 MHz), and that a station is within a few hundred metres to start."],
            ["MQTT connection failed", `The Pi must reach ${safe.broker}:${safe.port}. Test with a ping, or ask whoever runs the broker if it needs a login.`],
          ].map(([q, a]) => (
            <div key={q}>
              <dt className="font-medium">{q}</dt>
              <dd className="mt-0.5 text-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-8 flex justify-end">
        <Link to="/deploy" search={{ station: undefined }} className="inline-flex min-h-11 items-center rounded-full bg-kelp px-5 text-sm font-medium text-paper transition-[filter] duration-150 not-disabled:hover:brightness-110">
          Next: Deploy and Publish
        </Link>
      </div>
    </main>
  );
}

function Field({ label, help, error, children }: { label: string; help?: string; error: string | null; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span>
        {label}
        {help ? <span className="text-muted"> ({help})</span> : null}
      </span>
      {children}
      {error ? <span className="text-xs text-copper">{error}</span> : null}
    </label>
  );
}
