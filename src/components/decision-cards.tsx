import { levelWord, type DecisionCard, type Level } from "@/lib/place/decide";
import { cn } from "@/lib/utils";

const LEVEL_STYLE: Record<Level, string> = {
  act: "border-warn",
  watch: "border-brand",
  ok: "border-line",
  unknown: "border-dashed border-line",
};

const DOT: Record<Level, string> = {
  act: "bg-warn",
  watch: "bg-brand",
  ok: "bg-brand-deep/40",
  unknown: "bg-line",
};

/**
 * One card per concern. The level word comes first so a steward can scan the column on a
 * bad day; the evidence, exposure, and threshold lines are there for the person who asks why.
 */
export function DecisionCards({ cards, compact = false }: { cards: DecisionCard[]; compact?: boolean }) {
  if (!cards.length) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
        No concern named yet. The wizard's "what has caught people off guard" step feeds this list.
      </p>
    );
  }
  return (
    <ul className={cn("grid gap-3", !compact && "lg:grid-cols-2")}>
      {cards.map((card) => (
        <li key={card.id} className={cn("rounded-lg border bg-panel px-4 py-4", LEVEL_STYLE[card.level])}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">{card.title}</p>
            <p className="flex items-center gap-2 text-sm">
              <span className={cn("size-2.5 rounded-full", DOT[card.level])} aria-hidden="true" />
              {levelWord(card.level)}
            </p>
          </div>
          <p className="mt-2">{card.headline}</p>
          {!compact ? (
            <>
              <ul className="mt-2 grid gap-1 text-sm text-muted">
                {card.evidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
                {card.exposure.map((line) => (
                  <li key={line} className="border-l-2 border-brand pl-2">
                    {line}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm">
                <span className="text-muted">Do: </span>
                {card.action}
              </p>
              <p className="mt-2 text-xs text-muted">{card.thresholds}</p>
            </>
          ) : (
            <p className="mt-2 text-sm">
              <span className="text-muted">Do: </span>
              {card.action}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
