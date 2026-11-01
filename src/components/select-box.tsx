import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  /** A short second line under the label, for example when a station last reported. */
  hint?: string;
};

/**
 * The site's dropdown. The browser's own list cannot be styled, so this draws the menu itself (keyboard,
 * screen-reader and typeahead behaviour come from Radix Select): a trigger that looks like the other fields,
 * and a rounded menu that opens right under it, with the chosen item ticked and the hovered one tinted.
 */
export function SelectBox({
  value,
  onChange,
  options,
  label,
  placeholder = "Choose…",
  className,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Read by screen readers; the visible label sits next to the control. */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        aria-label={label}
        className={cn(
          "group inline-flex min-h-11 w-full max-w-sm items-center justify-between gap-3 rounded-xl border border-line bg-card px-3 text-left text-ink",
          "transition-colors hover:border-kelp focus-visible:border-kelp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kelp data-[state=open]:border-kelp",
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <Select.Value placeholder={placeholder} />
        </span>
        <Select.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          className="z-[60] max-h-[min(22rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] min-w-56 overflow-hidden rounded-xl border border-line bg-card shadow-xl data-[state=open]:animate-[select-in_140ms_ease-out]"
        >
          <Select.Viewport className="p-1.5">
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                className="relative flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-lg py-1.5 pl-3 pr-9 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-moss data-[highlighted]:text-kelp-deep data-[state=checked]:font-medium"
              >
                <span className="min-w-0">
                  <Select.ItemText>{o.label}</Select.ItemText>
                  {o.hint ? <span className="block truncate text-xs font-normal text-muted">{o.hint}</span> : null}
                </span>
                <Select.ItemIndicator className="absolute right-3 grid place-items-center text-kelp">
                  <Check className="size-4" aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
