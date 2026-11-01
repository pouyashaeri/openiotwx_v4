import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { buildPlan, flashHref } from "@/lib/wizard/plan";
import { useDraft } from "@/lib/wizard/store";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/wizard", label: "Wizard" },
  { to: "/plan", label: "Plan" },
  { to: "/analysis", label: "Analysis" },
  { to: "/forecast", label: "Forecast" },
  { to: "/community", label: "Community" },
  { to: "/library", label: "Library" },
  { to: "/map", label: "Map" },
] as const;

const WORDMARK = "openiotwx/";
// What the name spells while hovered: a different short phrase about the work each time.
const PHRASES = ["plan-it-out", "sense-local"];

/**
 * The site name. On hover or focus it types itself away and spells a short phrase, then types the name
 * back when the pointer leaves (the static flasher pages do the same in public/flash-wizard/header.js).
 */
function Wordmark({ phrase }: { phrase: string | null }) {
  const hovered = phrase !== null;
  const want = phrase ?? WORDMARK;
  const [text, setText] = useState(WORDMARK);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  useEffect(() => {
    if (reduced) {
      setText(want);
      return;
    }
    if (text === want) return;
    const typing = want.startsWith(text);
    const id = setTimeout(() => setText(typing ? want.slice(0, text.length + 1) : text.slice(0, -1)), typing ? 55 : 28);
    return () => clearTimeout(id);
  }, [text, want, reduced]);
  const caret = hovered || text !== want;
  return (
    <span aria-hidden="true" className="inline-block min-w-[10ch] font-mono text-base font-semibold leading-none tracking-tight">
      {[...text].map((ch, i) =>
        ch === "/" ? (
          <span key={i} className="text-blue-300">
            /
          </span>
        ) : (
          ch
        ),
      )}
      {caret ? <span className="type-caret" /> : null}
    </span>
  );
}

// Shared with the static flasher pages, whose header reads the same key.
const ACCOUNT_KEY = "openiotwx-acct";

/** Sign-in entry, or the signed-in person's system. */
function AccountNav({ path, stacked = false }: { path: string; stacked?: boolean }) {
  const { user, isPending } = useCurrentUserState();
  // The last answer is remembered, so the buttons never blink away while the session is checked.
  const [remembered, setRemembered] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(ACCOUNT_KEY);
      if (v) setRemembered(v === "in");
    } catch {
      /* storage unavailable: fall back to waiting */
    }
  }, []);
  useEffect(() => {
    if (isPending) return;
    try {
      localStorage.setItem(ACCOUNT_KEY, user ? "in" : "out");
    } catch {
      /* ignore */
    }
  }, [isPending, user]);
  const signedIn = isPending ? remembered : Boolean(user);
  if (signedIn === null) return null;
  if (!signedIn)
    return (
      <Link
        to="/login"
        search={{ next: "/account" }}
        className={cn(
          "btn-glow inline-flex shrink-0 items-center justify-center rounded-lg bg-white/15 font-semibold text-white hover:bg-white/25",
          stacked ? "mt-1 min-h-12 text-base" : "h-9 px-4 text-sm",
        )}
      >
        Sign in
      </Link>
    );
  return (
    <>
      <Link
        to="/account"
        className={cn(
          "inline-flex shrink-0 items-center rounded-lg border border-white/20 font-medium text-white transition-colors hover:bg-white/10",
          stacked ? "min-h-12 px-3 text-base" : "h-9 px-3.5 text-sm",
          path === "/account" && "bg-white/10",
        )}
      >
        My system
      </Link>
      <button
        type="button"
        className={cn(
          "inline-flex shrink-0 items-center rounded-lg font-medium text-blue-100/70 transition-colors hover:bg-white/[0.07] hover:text-white",
          stacked ? "min-h-12 w-full px-3 text-base" : "h-9 px-3 text-sm",
        )}
        onClick={() => void signOut().catch(() => undefined)}
      >
        Sign out
      </button>
    </>
  );
}

export function SiteHeader() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const answers = useDraft((state) => state.answers);
  const siteName = useDraft((state) => state.siteName);
  // With a finished plan, Flash opens the wizard already set to the plan's board.
  const flash = flashHref(buildPlan(answers, siteName)) ?? "/flash-wizard/index.html";
  const [open, setOpen] = useState(false);
  const [logoHover, setLogoHover] = useState(false);
  const [phraseNo, setPhraseNo] = useState(0);
  // A page that loads with the pointer already resting on the logo makes the browser report a hover.
  // The name only reacts once the pointer has really moved, so it never starts on its own.
  const pointerMoved = useRef(false);
  const startHover = () => {
    if (logoHover || !pointerMoved.current) return;
    setPhraseNo((n) => n + 1);
    setLogoHover(true);
  };
  useEffect(() => {
    const moved = () => {
      pointerMoved.current = true;
    };
    window.addEventListener("pointermove", moved, { passive: true });
    return () => window.removeEventListener("pointermove", moved);
  }, []);
  // Close the menu after any navigation, and on Escape.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Desktop: quiet text links; the current page gets a thin marker on the header's lower edge.
  const desktopLink = (active: boolean) =>
    cn(
      "relative inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors",
      active
        ? "text-white after:absolute after:inset-x-3 after:-bottom-[14px] after:h-0.5 after:rounded-full after:bg-blue-400"
        : "text-blue-100/70 hover:bg-white/[0.07] hover:text-white",
    );
  const mobileLink = (active: boolean) =>
    cn(
      "flex min-h-12 items-center rounded-lg border-l-2 px-3 text-base font-medium transition-colors",
      active ? "border-blue-400 bg-white/10 text-white" : "border-transparent text-blue-100/70 hover:text-white",
    );

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-navy/95 text-white backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
        <Link
          to="/"
          aria-label="OpenIoTwx home"
          className="flex shrink-0 items-center gap-2.5 text-white"
          onMouseEnter={startHover}
          onMouseMove={startHover}
          onMouseLeave={() => setLogoHover(false)}
          onFocus={(e) => {
            // Keyboard focus only: a mouse click also focuses the link, and that must not replay it.
            if (!e.currentTarget.matches(":focus-visible")) return;
            setPhraseNo((n) => n + 1);
            setLogoHover(true);
          }}
          onBlur={() => setLogoHover(false)}
        >
          <span className="logo-mark grid size-8 shrink-0 place-items-center rounded-md bg-brand" data-morph={logoHover ? "true" : "false"}>
            <svg className="logo-glyph" viewBox="0 0 64 64" width="32" height="32" aria-hidden="true" focusable="false">
              <circle cx="32" cy="32" r="8" fill="none" stroke="#fff" strokeWidth="4" />
              <path d="M40 50 L51.5 16" fill="none" stroke="#93c5fd" strokeWidth="6" strokeLinecap="round" />
            </svg>
          </span>
          <Wordmark phrase={logoHover ? PHRASES[phraseNo % PHRASES.length] : null} />
        </Link>

        <nav aria-label="Primary" className="hidden min-w-0 flex-1 items-center justify-end gap-1 lg:flex">
          {LINKS.map((item) => {
            const active = path === item.to;
            return (
              <Link key={item.to} to={item.to} className={desktopLink(active)} aria-current={active ? "page" : undefined}>
                {item.label}
              </Link>
            );
          })}
          <a href={flash} className={desktopLink(false)}>
            Flash
          </a>
          <span aria-hidden="true" className="mx-3 h-5 w-px bg-white/15" />
          <div className="flex items-center gap-1">
            <AccountNav path={path} />
          </div>
        </nav>

        <button
          type="button"
          className="ml-auto grid size-11 shrink-0 place-items-center rounded-lg text-white hover:bg-white/10 lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? (
              <path d="M4 4 L18 18 M18 4 L4 18" />
            ) : (
              <path d="M3 6 H19 M3 11 H19 M3 16 H19" />
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <nav
          id="mobile-menu"
          aria-label="Menu"
          className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-white/10 px-4 pb-4 pt-2 lg:hidden"
        >
          <div className="mx-auto grid max-w-5xl gap-0.5">
            {LINKS.map((item) => {
              const active = path === item.to;
              return (
                <Link key={item.to} to={item.to} className={mobileLink(active)} aria-current={active ? "page" : undefined}>
                  {item.label}
                </Link>
              );
            })}
            <a href={flash} className={mobileLink(false)}>
              Flash
            </a>
            <div className="mt-2 grid gap-0.5 border-t border-white/10 pt-2">
              <AccountNav path={path} stacked />
            </div>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 bg-navy text-blue-100/80">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>An open source NSF NCAR community project. Data sharing stays a choice, and the infrastructure is yours to run.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link to="/gdex" className="font-mono text-xs text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
            data-and-gdex
          </Link>
          <Link to="/contact" className="font-mono text-xs text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
            contact
          </Link>
          <a
            className="font-mono text-xs text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
            href="https://ncar.github.io/openiotwx/"
          >
            earlier-manuals ↗
          </a>
          <a
            className="font-mono text-xs text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
            href="https://github.com/NCAR/mesonet-siparcs25"
          >
            mesonet-siparcs25 ↗
          </a>
        </div>
      </div>
    </footer>
  );
}