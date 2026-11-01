import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { LinkMarquee } from "@/components/link-marquee";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { ChoiceCard } from "@/components/choice-card";
import { INTENTS } from "@/lib/wizard/catalog";
import { PURPOSES } from "@/lib/wizard/purpose";
import { useDraft } from "@/lib/wizard/store";
import type { Intent } from "@/lib/wizard/types";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const hydrated = useDraft((state) => state.hydrated);
  const siteName = useDraft((state) => state.siteName);
  const step = useDraft((state) => state.step);
  const intent = useDraft((state) => state.answers.intent);
  const reset = useDraft((state) => state.reset);
  const setIntent = useDraft((state) => state.setIntent);
  const setStep = useDraft((state) => state.setStep);
  const navigate = useNavigate();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [started, setStarted] = useState(false);

  function begin(id: Intent) {
    setStarted(true);
    reset();
    setIntent(id);
    setStep("place");
    void navigate({ to: "/wizard" });
  }

  return (
    <main id="content">
      <section className="grid-bg text-white">
        <div className="relative mx-auto max-w-5xl px-4 py-14 sm:py-20">
          <a
            href="https://ncar.ucar.edu/"
            aria-label="NCAR and UCAR"
            className="group absolute top-[3.25rem] right-4 sm:top-[3.75rem]"
          >
            <img
              src="/ncar-logo.png"
              alt="NCAR and UCAR"
              className="h-10 w-auto brightness-[1.1] drop-shadow-[0_3px_8px_rgba(0,4,16,0.9)] transition-[filter] duration-300 group-hover:brightness-[1.30] sm:h-12"
            />
          </a>
          <p className="max-w-[55%] font-mono text-xs tracking-widest text-blue-300 uppercase sm:max-w-none">
            Open environmental sensing
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] font-semibold sm:text-6xl">
            Start with the place, not the parts list.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-blue-100/80">
            Say what the site has to live with. Leave with a station configuration, a community
            plan, and a path from the first reading to a forecast and a decision, before anyone
            flashes a board.
          </p>
          <div className="no-print mt-8 flex flex-wrap gap-3">
            <a
              href="#start"
              className="btn-glow inline-flex min-h-11 items-center rounded-md bg-white px-5 text-sm font-semibold text-brand-deep hover:bg-blue-50"
            >
              Plan a station
            </a>
            <a
              href="#downloads"
              className="inline-flex min-h-11 items-center rounded-md border border-white/25 px-5 font-mono text-sm text-white hover:bg-white/10"
            >
              download files →
            </a>
            <Link
              to="/library"
              className="inline-flex min-h-11 items-center rounded-md border border-white/25 px-5 font-mono text-sm text-white hover:bg-white/10"
            >
              read the docs →
            </Link>
          </div>
        </div>
      </section>

      <section id="downloads" className="scroll-mt-16 border-b border-line bg-surface-2">
        <LinkMarquee>
          <div className="mx-auto max-w-5xl px-4 pb-8 pt-1">
            <h2 className="text-2xl">The pages to use, and the files to build from</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              Plan the station, then open the record, the forecast, and the print collective. The
              zips are the current NCAR main branch: every housing STL, and the Atom Lite source.
            </p>
          </div>
        </LinkMarquee>
      </section>

      <div id="start" className="mx-auto max-w-5xl -scroll-mt-3 px-4 py-10 sm:-scroll-mt-7 sm:py-14">
        {hydrated && intent && !started ? (
          <div className="no-print mb-8 flex flex-col gap-3 rounded-lg border border-line bg-brand-soft px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            {confirmDiscard ? (
              <>
                <p className="text-sm">
                  Discard this draft{siteName ? ` for ${siteName}` : ""}? This clears it from this
                  device.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-deep"
                    onClick={() => {
                      reset();
                      setConfirmDiscard(false);
                      toast("Draft discarded. Start a new one below.");
                    }}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-white px-4 text-sm transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep"
                    onClick={() => setConfirmDiscard(false)}
                  >
                    Keep it
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm">
                  A draft is already on this device{siteName ? ` for ${siteName}` : ""}.
                </p>
                <div className="flex items-center gap-2">
                  <Link
                    to={step === "review" ? "/plan" : "/wizard"}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand-deep"
                  >
                    Continue the draft
                  </Link>
                  <button
                    type="button"
                    aria-label="Discard draft"
                    title="Discard draft"
                    onClick={() => setConfirmDiscard(true)}
                    className="grid size-11 place-items-center rounded-md border border-line bg-white text-muted hover:border-brand hover:text-ink"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}

        <p className="eyebrow">01 / start</p>
        <h2 className="mt-2 text-2xl">What brings you here?</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {INTENTS.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={false}
              onSelect={() => begin(item.id)}
            />
          ))}
        </div>

        <section className="mt-14" aria-labelledby="pathway-title">
          <p className="eyebrow">The pathway</p>
          <h2 id="pathway-title" className="mt-2 text-2xl">
            From a local concern to a decision you can defend
          </h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {PATHWAY.map((stop, index) => (
              <li key={stop.to} className="rounded-lg border border-line bg-panel px-4 py-3">
                <Link to={stop.to} className="block">
                  <span className="font-mono text-xs text-brand tabular-nums">{index + 1}</span>
                  <span className="mt-1 block text-lg">{stop.title}</span>
                  <span className="mt-1 block text-sm text-muted">{stop.body}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-muted">
            Readings, dashboards, and forecasts run on infrastructure the community owns: a Raspberry Pi, a spare
            PC, or NSF NCAR's CIRRUS cloud, with the same containers. NCAR tools (CREDIT, GDEX, CIRRUS) are a
            choice at each step, never a requirement.
          </p>
        </section>

        <section className="mt-14 grid gap-4 sm:grid-cols-3">
          <Note
            kicker="02"
            title="Click together"
            body="No soldering and no breadboard. Qwiic and Grove parts, a 1 inch thread, and caps for the ports you are not using."
          />
          <Note
            kicker="03"
            title="Print, then wait"
            body="Most housings finish in under five hours. A full station with base accessories is about 35 hours on an entry-level printer."
          />
          <Note
            kicker="04"
            title="Keep the readings"
            body="FAIR and CARE sit under the project. Publishing to a public map is optional. A broker you control is a valid ending."
          />
        </section>

        <section className="mt-14" aria-labelledby="purpose-title">
          <p className="eyebrow">05 / purpose</p>
          <h2 id="purpose-title" className="mt-2 text-2xl">
            What this is for
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Same walk you would take through a house: what could go wrong, how exposed it is, how
            you would get through it, and what you arranged ahead of time. The wizard asks those
            things without handing you a score.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PURPOSES.map((item) => (
              <article key={item.id} className="rounded-lg border border-line bg-white px-4 py-4">
                <p className="font-mono text-xs tracking-wide text-brand uppercase">{item.term}</p>
                <h3 className="mt-1 text-xl">{item.plain}</h3>
                <p className="mt-2 text-sm text-muted">{item.guide}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <p className="eyebrow">06 / after the plan</p>
          <h2 className="mt-2 text-2xl">Where the draft goes next</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Link to="/analysis" className="rounded-lg border border-line bg-white px-4 py-4 transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep">
              <span className="font-mono text-xs text-brand">Analysis</span>
              <span className="mt-1 block text-sm text-muted">
                Station record, vulnerability index, and the choice to archive in GDEX.
              </span>
            </Link>
            <Link to="/forecast" className="rounded-lg border border-line bg-white px-4 py-4 transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep">
              <span className="font-mono text-xs text-brand">Forecast</span>
              <span className="mt-1 block text-sm text-muted">
                History, now, and the next day. CREDIT on this browser, BOINC, or CIRRUS.
              </span>
            </Link>
            <Link to="/community" className="rounded-lg border border-line bg-white px-4 py-4 transition-colors duration-150 not-disabled:hover:border-brand not-disabled:hover:bg-paper-deep">
              <span className="font-mono text-xs text-brand">Community</span>
              <span className="mt-1 block text-sm text-muted">
                The build collective: print queue, shared printers, and spare parts.
              </span>
            </Link>
          </div>
        </section>

        <section className="mt-14" aria-labelledby="gdex-band">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <h2 id="gdex-band" className="text-2xl">
                Readings that outlast the project
              </h2>
              <p className="mt-2 text-sm text-muted">
                Stations built here can join the NCAR research network and, with their steward&apos;s consent, have their data released to GDEX, the NSF NCAR archive: CF-compliant
                NetCDF with coordinates, units and metadata, and a DOI so others can cite it.
              </p>
            </div>
            <Link to="/gdex" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-line bg-white px-5 text-sm font-medium hover:border-brand">
              How data reaches GDEX
            </Link>
          </div>
        </section>

        <p className="mt-10 text-sm text-muted">
          Already flashing an Atom Lite or keeping an RP2040 station in the field?{" "}
          <Link to="/library" className="text-brand underline underline-offset-4">
            The field library
          </Link>{" "}
          holds the classic manuals.
        </p>
      </div>
    </main>
  );
}

const PATHWAY = [
  { to: "/wizard", title: "Plan", body: "Place, purpose, people, and what you can bring." },
  { to: "/community", title: "Build", body: "Print with the collective; borrow a printer or parts." },
  { to: "/plan", title: "Deploy", body: "Mount it, point it at your own broker, keep the checklist." },
  { to: "/analysis", title: "Analyze", body: "Readings beside the vulnerability and EJ picture of the place." },
  { to: "/forecast", title: "Decide", body: "A CREDIT forecast for this spot, and one card per concern." },
] as const;

function Note({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-line border-t-2 border-t-brand bg-surface-2 px-4 pt-3 pb-4">
      <p className="eyebrow">{kicker}</p>
      <h3 className="mt-2 text-xl">{title}</h3>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}

