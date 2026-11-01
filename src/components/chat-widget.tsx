import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Maximize2, MessageCircle, Minimize2, RotateCcw, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import chatAvatar from "@/assets/chat-avatar.png";
import { CHAT_CONFIG } from "@/lib/chat/config";
import {
  allIds,
  applySelection,
  handleUserMessage,
  initialState,
  openingTurn,
  summarize,
  type ChatState,
} from "@/lib/chat/engine";
import { createExtractor, probe, type ChatConfig } from "@/lib/chat/llm";
import type { FieldSpec } from "@/lib/chat/spec";
import { useDraft } from "@/lib/wizard/store";
import { cn } from "@/lib/utils";

type Message = { id: number; role: "bot" | "user"; text: string };
type Status = "checking" | "model" | "simple";

export function ChatWidget() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const hasDraft = useDraft((state) => state.hydrated && Boolean(state.answers.intent));

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chat, setChat] = useState<ChatState>(initialState);
  const [asking, setAsking] = useState<FieldSpec | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Choices ticked on a list question, before Send is pressed.
  const [picked, setPicked] = useState<string[]>([]);
  const [typedId, setTypedId] = useState<number | null>(null);
  // Basic (keyword) matching unless the site was built with a model server to talk to.
  const [status, setStatus] = useState<Status>(CHAT_CONFIG ? "checking" : "simple");
  const [expanded, setExpanded] = useState(false);
  // True while the window plays its closing animation, just before it is removed.
  const [closing, setClosing] = useState(false);
  const modelDown = useRef(!CHAT_CONFIG);
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const push = useCallback((role: Message["role"], text: string) => {
    const id = nextId.current++;
    setMessages((list) => [...list, { id, role, text }]);
    return id;
  }, []);

  const checkModel = useCallback(async (cfg: ChatConfig) => {
    const result = await probe(cfg);
    const hasModel =
      result.ok &&
      (result.models.length === 0 ||
        result.models.some((id) => id === cfg.model || id.startsWith(`${cfg.model}:`)));
    modelDown.current = !hasModel;
    setStatus(hasModel ? "model" : "simple");
  }, []);

  const start = useCallback(() => {
    const turn = openingTurn();
    nextId.current = 1;
    setChat(turn.state);
    setAsking(turn.asking);
    setTypedId(null);
    setMessages([{ id: nextId.current++, role: "bot", text: turn.reply }]);
  }, []);

  // First open: say hello, and, only if the site has a model server, check that it is up.
  useEffect(() => {
    if (!open || messages.length > 0) return;
    start();
    if (CHAT_CONFIG) void checkModel(CHAT_CONFIG);
  }, [open, messages.length, start, checkModel]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, busy]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, typedId, picked.length]);

  const finishClose = useCallback(() => {
    setOpen(false);
    setClosing(false);
  }, []);

  const requestClose = useCallback(() => {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishClose();
      return;
    }
    setClosing(true);
  }, [closing, finishClose]);

  // Safety net: if the browser never reports the end of the animation, still close.
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(finishClose, 400);
    return () => window.clearTimeout(timer);
  }, [closing, finishClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (expanded) setExpanded(false);
      else requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, expanded, requestClose]);

  const extractor = useMemo(
    () =>
      CHAT_CONFIG
        ? createExtractor(CHAT_CONFIG, () => {
            modelDown.current = true;
            setStatus("simple");
          })
        : undefined,
    [],
  );

  const askingKey = asking?.key ?? null;
  useEffect(() => {
    setPicked([]);
  }, [askingKey]);

  const lastBot = [...messages].reverse().find((m) => m.role === "bot");
  const typingDone = lastBot ? typedId === lastBot.id : true;

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    push("user", text);
    setBusy(true);
    const turn = await handleUserMessage(chat, text, modelDown.current ? undefined : extractor);
    setChat(turn.state);
    setAsking(turn.asking);
    setBusy(false);
    push("bot", turn.reply);
  }

  /** Several ticked choices sent as one answer. */
  function sendPicked() {
    if (!asking || picked.length === 0 || busy) return;
    const everything = allIds(asking.key);
    const all = picked.length === everything.length;
    const titles = asking.options
      .filter((option) => picked.includes(String(option.id)))
      .map((option) => option.title);
    push("user", all ? "All of them" : titles.join(", "));
    setBusy(true);
    const turn = applySelection(chat, asking.key, picked);
    setChat(turn.state);
    setAsking(turn.asking);
    setBusy(false);
    push("bot", turn.reply);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function writePlan() {
    const draft = useDraft.getState();
    draft.reset();
    const { answers, siteName } = chat;
    if (answers.intent) draft.setIntent(answers.intent);
    draft.patchAnswers(answers);
    draft.setSiteName(siteName.trim());
    draft.setStep("review");
    requestClose();
    toast.success("Draft plan written from our chat");
    void navigate({ to: "/plan" });
  }

  const rows = summarize(chat);
  const done = asking === null && messages.length > 0;
  // The wizard's sticky Continue bar sits at the bottom of small screens; stay above it there.
  const lift = path === "/wizard" ? "bottom-20 sm:bottom-5" : "bottom-5";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Chat to plan your station"
        title="Chat to plan your station"
        className={cn(
          "no-print fixed right-5 z-40 grid size-14 place-items-center rounded-full bg-brand text-surface shadow-lg transition-transform hover:scale-105 hover:bg-brand-deep",
          lift,
        )}
      >
        <MessageCircle className="size-6" aria-hidden="true" />
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label="Plan your station by chatting"
      data-expanded={expanded}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === "chat-pop-out")
          finishClose();
      }}
      className={cn(
        "group/chat no-print fixed z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2xl",
        "transition-[width,height,right,bottom] duration-300 ease-out motion-reduce:transition-none",
        closing ? "chat-pop-out" : "chat-pop",
        expanded
          ? "bottom-3 right-3 h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)]"
          : "bottom-3 right-3 h-[min(42rem,calc(100dvh-5rem))] w-[calc(100%-1.5rem)] sm:bottom-5 sm:right-5 sm:w-[min(32rem,calc(100%-2.5rem))]",
      )}
    >
      <header className="flex items-center justify-between gap-2 bg-navy px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Plan with a chat</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            label="Start the chat over"
            onClick={() => {
              start();
            }}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            label={expanded ? "Exit full screen" : "Full screen"}
            onClick={() => setExpanded((v) => !v)}
            className="hidden sm:grid"
          >
            {expanded ? (
              <Minimize2 className="size-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-4" aria-hidden="true" />
            )}
          </IconButton>
          <IconButton label="Close the chat" onClick={requestClose}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        <div className="mx-auto w-full space-y-3 group-data-[expanded=true]/chat:max-w-3xl">
          {messages.map((message) => (
            <Bubble
              key={message.id}
              message={message}
              status={status}
              animate={
                message.role === "bot" && message.id === lastBot?.id && typedId !== message.id
              }
              onDone={() => setTypedId(message.id)}
            />
          ))}

          {busy ? (
            <div className="flex items-end gap-2">
              <Avatar status={status} />
              <div
                className="flex w-fit items-center gap-1 rounded-lg rounded-bl-sm bg-surface-2 px-3 py-3"
                aria-label="Thinking"
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-1.5 animate-bounce rounded-full bg-muted"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {!busy && typingDone && done ? (
            <div className="rounded-lg border border-line bg-brand-soft p-3 text-sm">
              <p className="eyebrow">Your answers</p>
              <dl className="mt-2 grid gap-1.5">
                {rows.map((row) => (
                  <div
                    key={`${row.key}-${row.label}`}
                    className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2"
                  >
                    <dt className="text-muted">{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                onClick={writePlan}
                className="mt-3 min-h-11 w-full rounded-md bg-brand px-4 text-sm font-medium text-surface hover:bg-brand-deep"
              >
                Write my plan
              </button>
              {hasDraft ? (
                <p className="mt-2 text-xs text-muted">
                  This replaces the draft saved on this device.
                </p>
              ) : null}
            </div>
          ) : null}

          {!busy && typingDone && asking && asking.options.length > 0 ? (
            asking.kind === "multi" ? (
              <div role="group" aria-label="Pick all that apply">
                <p className="mb-2 text-xs text-muted">
                  Tap every one that applies, or type it, like “all of them except rain”.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={picked.length === asking.options.length}
                    onClick={() =>
                      setPicked(picked.length === asking.options.length ? [] : allIds(asking.key))
                    }
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium",
                      picked.length === asking.options.length
                        ? "border-brand bg-brand text-surface"
                        : "border-brand text-brand-deep hover:bg-brand-soft",
                    )}
                  >
                    All of them
                  </button>
                  {asking.options.map((option) => {
                    const id = String(option.id);
                    const on = picked.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        title={option.hint}
                        aria-pressed={on}
                        onClick={() =>
                          setPicked(on ? picked.filter((item) => item !== id) : [...picked, id])
                        }
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-left text-xs",
                          on
                            ? "border-brand bg-brand-soft text-ink"
                            : "border-line bg-surface hover:border-brand",
                        )}
                      >
                        {on ? "✓ " : ""}
                        {option.title}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={picked.length === 0}
                    onClick={sendPicked}
                    className="min-h-10 rounded-md bg-brand px-4 text-sm font-medium text-surface hover:bg-brand-deep disabled:opacity-40"
                  >
                    {picked.length === 0 ? "Send selection" : `Send ${picked.length} selected`}
                  </button>
                  {asking.skippable ? (
                    <button
                      type="button"
                      onClick={() => void send("skip")}
                      className="min-h-10 rounded-md px-3 text-sm text-muted hover:text-ink"
                    >
                      Skip
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick answers">
                {asking.options.map((option) => (
                  <button
                    key={String(option.id)}
                    type="button"
                    title={option.hint}
                    onClick={() => void send(option.title)}
                    className="rounded-md border border-line bg-surface px-3 py-1.5 text-left text-xs hover:border-brand hover:bg-brand-soft"
                  >
                    {option.title}
                  </button>
                ))}
              </div>
            )
          ) : null}
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t border-line bg-surface p-3 group-data-[expanded=true]/chat:px-[max(0.75rem,calc(50%-24rem))]"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={busy}
          maxLength={600}
          placeholder={done ? "Change something, or press Write my plan" : "Type your answer…"}
          aria-label="Your answer"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-panel px-3 text-sm text-ink placeholder:text-muted disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="grid size-11 shrink-0 place-items-center rounded-md bg-brand text-surface hover:bg-brand-deep disabled:opacity-40"
        >
          <Send className="size-4" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

function IconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-md text-blue-100/80 hover:bg-white/10 hover:text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Bubble({
  message,
  animate,
  onDone,
  status,
}: {
  message: Message;
  animate: boolean;
  onDone: () => void;
  status: Status;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-brand px-3 py-2 text-sm text-surface group-data-[expanded=true]/chat:text-base">
        {message.text}
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2">
      <Avatar status={status} />
      <div className="w-fit max-w-[calc(100%-3.5rem)] rounded-lg rounded-bl-sm bg-surface-2 px-3 py-2 text-sm text-ink group-data-[expanded=true]/chat:text-base">
        {animate ? <Typed text={message.text} onDone={onDone} /> : message.text}
      </div>
    </div>
  );
}

/**
 * The assistant's picture, beside everything it says. The small dot at its lower right shows how
 * it is reading answers: green with a model, amber with basic keyword matching.
 */
function Avatar({ status }: { status: Status }) {
  return (
    <span className="relative shrink-0">
      <img
        src={chatAvatar}
        alt=""
        width={44}
        height={44}
        className="size-11 rounded-full group-data-[expanded=true]/chat:size-12"
        draggable={false}
      />
      <span
        className={cn(
          "absolute bottom-0 right-0 size-3 rounded-full ring-2 ring-surface-2",
          status === "model"
            ? "bg-emerald-500"
            : status === "simple"
              ? "bg-amber-400"
              : "bg-blue-400",
        )}
        aria-hidden="true"
      />
    </span>
  );
}

/** Types the text out a few characters at a time. Shows it all at once if motion is reduced. */
function Typed({ text, onDone }: { text: string; onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text.length);
      done.current();
      return;
    }
    setShown(0);
    let index = 0;
    const timer = window.setInterval(() => {
      index = Math.min(text.length, index + 2);
      setShown(index);
      if (index >= text.length) {
        window.clearInterval(timer);
        done.current();
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [text]);

  return (
    <>
      {text.slice(0, shown)}
      {shown < text.length ? (
        <span
          className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-ink"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
