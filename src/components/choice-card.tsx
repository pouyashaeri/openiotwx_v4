import { Check } from "lucide-react";
import { ChoiceIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

type Props = {
  icon: string;
  title: string;
  body: string;
  selected: boolean;
  onSelect: () => void;
};

export function ChoiceCard({ icon, title, body, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-28 w-full items-start gap-3 rounded-lg border px-4 py-4 text-left transition-colors duration-200",
        selected
          ? "border-brand bg-brand-soft text-ink"
          : "border-line bg-card text-ink hover:border-brand",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-11 shrink-0 place-items-center rounded-md",
          selected ? "bg-brand text-white" : "bg-paper-deep text-brand-deep",
        )}
      >
        <ChoiceIcon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="text-lg leading-tight">{title}</span>
          <span
            className={cn(
              "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border",
              selected ? "border-brand bg-brand text-white" : "border-line bg-card text-transparent",
            )}
            aria-hidden="true"
          >
            <Check className="size-3.5" strokeWidth={2.5} />
          </span>
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-muted">{body}</span>
      </span>
    </button>
  );
}
