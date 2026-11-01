import { useEffect, useRef, useState } from "react";

type Options = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as a destructive action. */
  danger?: boolean;
};
type Ask = Options & { resolve: (ok: boolean) => void };

let enqueue: ((ask: Ask) => void) | null = null;

/** A themed replacement for `window.confirm`: resolves true on confirm, false on cancel, Esc or a click outside. */
export function confirmDialog(options: Options): Promise<boolean> {
  return new Promise((resolve) => {
    if (enqueue) enqueue({ ...options, resolve });
    else resolve(window.confirm(options.message));
  });
}

/** Mount once near the root of the app. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<Ask[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = queue[0];

  useEffect(() => {
    enqueue = (ask) => setQueue((q) => [...q, ask]);
    return () => {
      enqueue = null;
    };
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (current && !el.open) el.showModal();
    if (!current && el.open) el.close();
  }, [current]);

  const answer = (ok: boolean) => {
    current?.resolve(ok);
    setQueue((q) => q.slice(1));
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onCancel={(e) => {
        e.preventDefault();
        answer(false);
      }}
      onClick={(e) => {
        if (e.target === dialog.current) answer(false);
      }}
      className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-navy/60 backdrop:backdrop-blur-[2px]"
    >
      {current ? (
        <div className="grid gap-4 p-6">
          <h2 id="confirm-title" className="font-display text-2xl">
            {current.title ?? "Are you sure?"}
          </h2>
          <p id="confirm-message" className="text-sm leading-relaxed text-muted">
            {current.message}
          </p>
          <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              autoFocus={current.danger}
              onClick={() => answer(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-5 text-sm hover:bg-paper-deep"
            >
              {current.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              autoFocus={!current.danger}
              onClick={() => answer(true)}
              className={`inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm text-white ${current.danger ? "bg-red-700 hover:bg-red-800" : "bg-kelp hover:brightness-110"}`}
            >
              {current.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
