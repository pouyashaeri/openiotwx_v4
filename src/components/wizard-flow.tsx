import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ChoiceCard } from "@/components/choice-card";
import { LocationPicker } from "@/components/location-picker";
import {
  COUNTS,
  GAPS,
  INTENTS,
  LINKS,
  MEASURES,
  PLACES,
  POWERS,
  PROGRESS,
  RESOURCES,
  SHARING,
  SURPRISES,
  TOOLS,
  WHO,
  intentLabel,
} from "@/lib/wizard/catalog";
import { stepPurpose } from "@/lib/wizard/purpose";
import { useDraft } from "@/lib/wizard/store";
import type { Intent, StepId } from "@/lib/wizard/types";
import { cn } from "@/lib/utils";

// v3 adds two steps for everyone: what people can bring (printers, parts, computers, a host)
// and where the readings live. A bench build still skips the community questions.
function stepsFor(intent: Intent): StepId[] {
  const steps: StepId[] = ["place", "link", "measures", "count"];
  if (intent !== "bench") steps.push("surprises", "people");
  steps.push("resources", "data", "review");
  return steps;
}

export function WizardFlow() {
  const hydrated = useDraft((state) => state.hydrated);
  const answers = useDraft((state) => state.answers);
  const step = useDraft((state) => state.step);
  const siteName = useDraft((state) => state.siteName);
  const setIntent = useDraft((state) => state.setIntent);
  const setStep = useDraft((state) => state.setStep);
  const patchAnswers = useDraft((state) => state.patchAnswers);
  const toggleMeasure = useDraft((state) => state.toggleMeasure);
  const toggleList = useDraft((state) => state.toggleList);
  const setSiteName = useDraft((state) => state.setSiteName);
  const navigate = useNavigate();
  const steps = answers.intent ? stepsFor(answers.intent) : [];
  const safeStep = steps.includes(step) ? step : (steps[0] ?? "place");

  useEffect(() => {
    if (!hydrated || !answers.intent) return;
    if (!stepsFor(answers.intent).includes(step)) setStep("place");
  }, [hydrated, answers.intent, step, setStep]);

  if (!hydrated) {
    return <p className="mx-auto max-w-3xl px-4 py-16 text-muted">Opening your draft…</p>;
  }

  if (!answers.intent) {
    return (
      <main id="content" className="mx-auto max-w-5xl px-4 py-8">
        <p className="text-sm text-kelp-deep">Start</p>
        <h1 className="mt-2 font-display text-4xl">What brings you here?</h1>
        <p className="mt-3 max-w-xl text-muted">
          Pick the path that matches the work. A bench build skips the community checklist.
        </p>
        <div className="mt-6 grid gap-3">
          {INTENTS.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={false}
              onSelect={() => {
                setIntent(item.id);
                setStep("place");
              }}
            />
          ))}
        </div>
      </main>
    );
  }

  const index = Math.max(0, steps.indexOf(safeStep));
  const current = safeStep;

  return (
    <main id="content" className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-sm text-muted">
        Step {index + 1} of {steps.length}
        <span className="px-2 text-line">/</span>
        {intentLabel(answers.intent)}
      </p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-paper-deep" aria-hidden="true">
        <div
          className="h-1 rounded-full bg-kelp"
          style={{ width: `${((index + 1) / steps.length) * 100}%` }}
        />
      </div>
      <div key={current} className="step-in">
        <StepBody
          step={current}
          siteName={siteName}
          onSiteName={setSiteName}
          onPatch={patchAnswers}
          onMeasure={toggleMeasure}
          onList={toggleList}
        />
      </div>
      <WizardNav
        canContinue={canContinue(current)}
        isLast={current === "review"}
        onBack={() => {
          if (index === 0) navigate({ to: "/" });
          else setStep(steps[index - 1] ?? "place");
        }}
        onNext={() => {
          if (current === "review") {
            navigate({ to: "/plan" });
            return;
          }
          setStep(steps[index + 1] ?? "review");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </main>
  );

  function canContinue(id: StepId): boolean {
    if (id === "place") return Boolean(answers.place);
    if (id === "link") return Boolean(answers.power && answers.link);
    if (id === "measures") return answers.measures.length > 0;
    if (id === "count") return Boolean(answers.count);
    if (id === "surprises") return answers.surprises.length > 0;
    if (id === "people") {
      return answers.who.length > 0 && answers.progress.length > 0 && answers.gaps.length > 0;
    }
    if (id === "data") return Boolean(answers.sharing);
    return true;
  }
}

function WizardNav({
  canContinue,
  isLast,
  onBack,
  onNext,
}: {
  canContinue: boolean;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="no-print sticky bottom-0 z-10 -mx-4 mt-8 border-t border-line bg-paper px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="min-h-11 rounded-md px-4 text-sm text-muted">
          Back
        </button>
        <button
          type="button"
          disabled={!canContinue}
          onClick={onNext}
          className="min-h-11 rounded-md bg-brand px-5 text-sm font-medium text-white disabled:opacity-40"
        >
          {isLast ? "Write the draft" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function StepBody({
  step,
  siteName,
  onSiteName,
  onPatch,
  onMeasure,
  onList,
}: {
  step: StepId;
  siteName: string;
  onSiteName: (value: string) => void;
  onPatch: (patch: Partial<ReturnType<typeof useDraft.getState>["answers"]>) => void;
  onMeasure: (id: ReturnType<typeof useDraft.getState>["answers"]["measures"][number]) => void;
  onList: ReturnType<typeof useDraft.getState>["toggleList"];
}) {
  const answers = useDraft((state) => state.answers);
  if (step === "place") {
    return (
      <StepFrame
        step="place"
        kicker="The place"
        title="Where will your station be placed?"
        body="A station is a small sensor box you build and install, indoors or out. Pick the setting closest to yours."
      >
        <div className="grid gap-3">
          {PLACES.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.place === item.id}
              onSelect={() => onPatch({ place: item.id })}
            />
          ))}
        </div>
      </StepFrame>
    );
  }
  if (step === "link") {
    return (
      <StepFrame
        step="link"
        kicker="Power and connection"
        title="How will your station be powered?"
        body="Pick what is really available at the spot, not what you hope to add later."
      >
        <div className="grid gap-3">
          {POWERS.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.power === item.id}
              onSelect={() => onPatch({ power: item.id })}
            />
          ))}
        </div>
        <section className="mt-8" aria-labelledby="comms-title">
          <p className="eyebrow">Step 2a</p>
          <h2 id="comms-title" className="mt-2 text-2xl">
            What communication technology is available?
          </h2>
          <p className="mt-2 max-w-xl text-sm text-muted">
            This is how your station will send its readings. Choose the one that works where you
            want to place it.
          </p>
          <div className="mt-4 grid gap-3">
            {LINKS.map((item) => (
              <ChoiceCard
                key={item.id}
                icon={item.icon}
                title={item.title}
                body={item.body}
                selected={answers.link === item.id}
                onSelect={() => onPatch({ link: item.id })}
              />
            ))}
          </div>
        </section>
      </StepFrame>
    );
  }
  if (step === "measures") {
    return (
      <StepFrame
        step="measures"
        kicker="What to notice"
        title="What data should your station collect?"
        body="Choose every community measurement that matters to you. You can drop one later."
      >
        <div className="grid gap-3">
          {MEASURES.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.measures.includes(item.id)}
              onSelect={() => onMeasure(item.id)}
            />
          ))}
        </div>
        <button
          type="button"
          aria-pressed={answers.sharp}
          onClick={() => onPatch({ sharp: !answers.sharp })}
          className={cn(
            "mt-3 w-full rounded-lg border px-4 py-4 text-left",
            answers.sharp ? "border-brand bg-brand-soft" : "border-line bg-white",
          )}
        >
          <span className="font-display text-lg">Temperatures here swing hard</span>
          <span className="mt-1 block text-sm text-muted">
            Prefer a sensor that stays accurate in extreme heat or cold. Everyday sensors are
            simpler and also report volatile organic compounds (VOCs) in the air, which the
            extreme-weather sensors do not.
          </span>
        </button>
      </StepFrame>
    );
  }
  if (step === "count") {
    return (
      <StepFrame
        step="count"
        kicker="How many"
        title="How many stations do you want?"
        body="Print time and the parts list scale with this number."
      >
        <div className="grid gap-3">
          {COUNTS.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.count === item.id}
              onSelect={() => onPatch({ count: item.id })}
            />
          ))}
        </div>
      </StepFrame>
    );
  }
  if (step === "surprises") {
    return (
      <StepFrame
        step="surprises"
        kicker="The place, again"
        title={
          answers.intent === "teach"
            ? "What should people be able to notice at your site?"
            : "What has caught people off guard at your site?"
        }
        body="Pick every pattern that is actually true. This is not a score."
      >
        <div className="grid gap-3">
          {SURPRISES.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.surprises.includes(item.id)}
              onSelect={() => onList("surprises", item.id)}
            />
          ))}
        </div>
      </StepFrame>
    );
  }
  if (step === "people") {
    return (
      <StepFrame
        step="people"
        kicker="The people"
        title="Who is your station for, and what would better look like?"
        body="Three short groups. Choose at least one in each."
      >
        <Group
          label="Who needs to be able to use it?"
          hint="Response starts with a person who can open this plan."
        >
          {WHO.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.who.includes(item.id)}
              onSelect={() => onList("who", item.id)}
            />
          ))}
        </Group>
        <Group
          label="Six months from now, which of these would matter?"
          hint="How you would recover: a backup, a practice run, readings you still control."
        >
          {PROGRESS.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.progress.includes(item.id)}
              onSelect={() => onList("progress", item.id)}
            />
          ))}
        </Group>
        <Group
          label="What is in the way right now?"
          hint="How ready you are today. Naming the gap is the point, not a score."
        >
          {GAPS.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.gaps.includes(item.id)}
              onSelect={() => onList("gaps", item.id)}
            />
          ))}
        </Group>
      </StepFrame>
    );
  }
  if (step === "resources") {
    return (
      <StepFrame
        step="resources"
        kicker="Resources"
        title="What can the people around this station bring?"
        body="Pick what is really on hand. Each answer unlocks something on the Community page: a printer joins the build collective, a spare computer joins the forecast pool, a host runs the server. Nothing here is required."
      >
        <div className="grid gap-3">
          {RESOURCES.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.resources.includes(item.id)}
              onSelect={() => onList("resources", item.id)}
            />
          ))}
        </div>
      </StepFrame>
    );
  }
  if (step === "data") {
    return (
      <StepFrame
        step="data"
        kicker="The data"
        title="Where should the readings live?"
        body="Each option is more open than the one before it. You can move up or down the list later; the plan records the decision and the date."
      >
        <div className="grid gap-3">
          {SHARING.map((item) => (
            <ChoiceCard
              key={item.id}
              icon={item.icon}
              title={item.title}
              body={item.body}
              selected={answers.sharing === item.id}
              onSelect={() => onPatch({ sharing: item.id })}
            />
          ))}
        </div>
        <button
          type="button"
          aria-pressed={answers.gdex}
          onClick={() => onPatch({ gdex: !answers.gdex })}
          className={cn(
            "mt-3 w-full rounded-lg border px-4 py-4 text-left",
            answers.gdex ? "border-brand bg-brand-soft" : "border-line bg-panel",
          )}
        >
          <span className="text-lg">Also archive and publish in GDEX</span>
          <span className="mt-1 block text-sm text-muted">
            {TOOLS.gdex.what} This is an opt-in: off until you turn it on, and reversible. The plan's
            data section shows exactly what would be published and under which license before anything
            leaves your server.
          </span>
        </button>
      </StepFrame>
    );
  }
  return <ReviewStep siteName={siteName} onSiteName={onSiteName} />;
}

function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="font-display text-xl">{label}</h2>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

function StepFrame({
  step,
  kicker,
  title,
  body,
  children,
}: {
  step: StepId;
  kicker: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  const purpose = stepPurpose(step);
  return (
    <section className="mt-8" aria-labelledby="step-title">
      <p className="eyebrow">{kicker}</p>
      <p className="mt-1 text-sm text-muted">
        {purpose.term}: {purpose.plain}
      </p>
      <h1 id="step-title" className="mt-2 text-4xl">
        {title}
      </h1>
      <p className="mt-3 max-w-xl text-muted">{purpose.line}</p>
      <p className="mt-2 max-w-xl text-sm text-muted">{body}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function ReviewStep({
  siteName,
  onSiteName,
}: {
  siteName: string;
  onSiteName: (value: string) => void;
}) {
  const answers = useDraft((state) => state.answers);
  const [localName, setLocalName] = useState(siteName);
  return (
    <StepFrame
      step="review"
      kicker="Draft"
      title="Name the place, then write the plan."
      body="You can revise any answer after. Goal posts stay put until you edit them."
    >
      <label className="block text-sm text-muted" htmlFor="site-name">
        What should we call this place?
      </label>
      <input
        id="site-name"
        value={localName}
        onChange={(event) => {
          setLocalName(event.target.value);
          onSiteName(event.target.value);
        }}
        placeholder="North lot, harbor road"
        className="mt-2 w-full rounded-2xl border border-line bg-card px-4 py-3 text-ink"
      />
      <div className="mt-6">
        <LocationPicker />
      </div>
      <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <Fact term="Path" detail={answers.intent ? intentLabel(answers.intent) : ""} />
        <Fact term="Place" detail={labelOf(PLACES, answers.place)} />
        <Fact term="Power" detail={labelOf(POWERS, answers.power)} />
        <Fact term="Connection" detail={labelOf(LINKS, answers.link)} />
        <Fact term="Stations" detail={labelOf(COUNTS, answers.count)} />
        <Fact
          term="Noticing"
          detail={
            answers.measures
              .map((id) => MEASURES.find((item) => item.id === id)?.title)
              .filter(Boolean)
              .join(", ") || "None"
          }
        />
        <Fact term="Extremes" detail={answers.sharp ? "Precision parts" : "Everyday parts"} />
        <Fact
          term="On hand"
          detail={
            answers.resources
              .map((id) => RESOURCES.find((item) => item.id === id)?.title)
              .filter(Boolean)
              .join(", ") || "Nothing named yet"
          }
        />
        <Fact
          term="Readings live"
          detail={`${labelOf(SHARING, answers.sharing)}${answers.gdex ? " · GDEX opt-in on" : ""}`}
        />
      </dl>
    </StepFrame>
  );
}

function Fact({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3">
      <dt className="text-muted">{term}</dt>
      <dd className="mt-1 text-ink">{detail}</dd>
    </div>
  );
}

function labelOf(list: ReadonlyArray<{ id: string | number; title: string }>, id: string | number | null) {
  return list.find((item) => item.id === id)?.title ?? "Not set";
}
