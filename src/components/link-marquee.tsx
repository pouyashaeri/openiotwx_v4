import { Link } from "@tanstack/react-router";
import { BookOpen, ChartLine, ClipboardList, CloudSun, Cpu, HeartHandshake, Package, Printer, WandSparkles, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DOCS } from "@/lib/wizard/catalog";
import { cn } from "@/lib/utils";

type Item = {
  key: string;
  label: string;
  /** Fades in under the label while the item is hovered or focused. */
  caption: string;
  icon: LucideIcon;
  /** The icon's colour while hovered or focused (it is grey otherwise). */
  text: string;
  /** The soft glow behind the icon while hovered or focused. */
  glow: string;
  to?: "/wizard" | "/plan" | "/analysis" | "/forecast" | "/community" | "/library";
  href?: string;
  external?: boolean;
};

const ITEMS: Item[] = [
  { key: "wizard", label: "Wizard", caption: "Answer a few questions", icon: WandSparkles, text: "group-hover:text-violet-600 group-focus-visible:text-violet-600", glow: "bg-violet-400", to: "/wizard" },
  { key: "plan", label: "Plan", caption: "Your station plan", icon: ClipboardList, text: "group-hover:text-sky-600 group-focus-visible:text-sky-600", glow: "bg-sky-400", to: "/plan" },
  { key: "analysis", label: "Analysis", caption: "The place and its people", icon: ChartLine, text: "group-hover:text-emerald-600 group-focus-visible:text-emerald-600", glow: "bg-emerald-400", to: "/analysis" },
  { key: "forecast", label: "Forecast", caption: "What the weather will do", icon: CloudSun, text: "group-hover:text-amber-500 group-focus-visible:text-amber-500", glow: "bg-amber-400", to: "/forecast" },
  { key: "community", label: "Community", caption: "Build it with others", icon: HeartHandshake, text: "group-hover:text-rose-500 group-focus-visible:text-rose-500", glow: "bg-rose-400", to: "/community" },
  { key: "library", label: "Library", caption: "Guides, parts and files", icon: BookOpen, text: "group-hover:text-teal-600 group-focus-visible:text-teal-600", glow: "bg-teal-400", to: "/library" },
  { key: "stl", label: "STL zip", caption: "Every housing STL", icon: Package, text: "group-hover:text-orange-500 group-focus-visible:text-orange-500", glow: "bg-orange-400", href: DOCS.stlZip },
  { key: "firmware", label: "Atom Lite code", caption: "The station's firmware", icon: Cpu, text: "group-hover:text-indigo-600 group-focus-visible:text-indigo-600", glow: "bg-indigo-400", href: DOCS.firmwareZip },
  { key: "print", label: "One-file STLs ↗", caption: "Print it in one go", icon: Printer, text: "group-hover:text-pink-500 group-focus-visible:text-pink-500", glow: "bg-pink-400", href: DOCS.print, external: true },
];

/** Pixels per second: slow enough to read, fast enough to notice. */
const SPEED = 36;
/** How quickly the bar settles, in seconds (smaller is quicker). Stopping is snappier than starting again. */
const STOP_TAU = 0.1;
const START_TAU = 0.35;
/**
 * One item's width. Nine items plus one more must fit the screen, so that at every moment of the drift
 * all nine are whole on screen; below about 800px wide they cannot all fit, and the bar just drifts.
 */
const ITEM_W = "clamp(80px, calc((100vw - 64px) / 10), 128px)";

function Entry({ item, tabIndex }: { item: Item; tabIndex: number }) {
  const Icon = item.icon;
  const body = (
    <>
      <span className="relative grid size-14 place-items-center">
        <span aria-hidden="true" className={cn("absolute inset-3 rounded-full opacity-0 blur-lg transition-opacity duration-300 group-hover:opacity-55 group-focus-visible:opacity-55", item.glow)} />
        <Icon
          className={cn("marquee-icon relative size-9 text-neutral-400 transition-[color,transform] duration-300 group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5", item.text)}
          strokeWidth={1.4}
          aria-hidden="true"
        />
      </span>
      <span className="mt-1.5 block text-[13px] font-medium leading-tight text-neutral-500 transition-colors duration-300 group-hover:text-ink group-focus-visible:text-ink">{item.label}</span>
      <span className="mt-1 block text-[11px] leading-snug text-muted opacity-0 transition duration-300 [transform:translateY(4px)] group-hover:opacity-100 group-hover:[transform:none] group-focus-visible:opacity-100 group-focus-visible:[transform:none]">
        {item.caption}
      </span>
    </>
  );
  const cls =
    "marquee-item group relative flex h-32 w-[var(--mq-w)] shrink-0 select-none flex-col items-center px-2 text-center outline-none transition-opacity duration-300 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-brand";
  return item.to ? (
    <Link to={item.to} className={cls} tabIndex={tabIndex} draggable={false}>
      {body}
    </Link>
  ) : (
    <a href={item.href} className={cls} tabIndex={tabIndex} draggable={false} {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : { rel: "noopener" })}>
      {body}
    </a>
  );
}

/**
 * The pages and downloads as a bar of icons drifting slowly from right to left.
 *
 * - Anywhere over the section (the bar or the words under it) it eases to a stop, quickly; when the pointer
 *   leaves it eases back up to its old speed. A finger or the keyboard stops it too.
 * - A horizontal trackpad swipe or a drag moves it by hand. A vertical swipe scrolls the page as usual.
 * - There is never a scrollbar. With reduced motion it does not drift and can be moved by hand.
 *
 * `children` is the heading and text under the bar; they are part of the hover area.
 */
export function LinkMarquee({ children }: { children?: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const firstSet = useRef<HTMLUListElement>(null);
  const target = useRef(SPEED);
  const offset = useRef(0);
  const visible = useRef(true);
  const resume = useRef<number | undefined>(undefined);
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const [copies, setCopies] = useState(3);
  const [reduced, setReduced] = useState(false);

  const wrap = (v: number) => {
    const w = firstSet.current?.offsetWidth ?? 0;
    return w > 0 ? ((v % w) + w) % w : 0;
  };
  const place = () => {
    if (track.current) track.current.style.transform = `translate3d(${(-offset.current).toFixed(2)}px,0,0)`;
  };

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Enough copies of the set to cover the bar however wide it is, so there is never a gap.
  useEffect(() => {
    if (reduced) return setCopies(1);
    const measure = () => {
      const set = firstSet.current?.offsetWidth ?? 0;
      const bar = viewport.current?.offsetWidth ?? 0;
      if (set > 0) setCopies(Math.max(2, Math.ceil(bar / set) + 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (viewport.current) ro.observe(viewport.current);
    if (firstSet.current) ro.observe(firstSet.current);
    return () => ro.disconnect();
  }, [reduced]);

  // The drift: right to left, with the speed easing towards whatever the pointer asks for.
  useEffect(() => {
    if (reduced) return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting));
    if (viewport.current) io.observe(viewport.current);
    let speed = SPEED;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const width = firstSet.current?.offsetWidth ?? 0;
      if (visible.current && width > 0 && track.current) {
        const goal = target.current;
        speed += (goal - speed) * (1 - Math.exp(-dt / (goal === 0 ? STOP_TAU : START_TAU)));
        if (goal === 0 && speed < 0.05) speed = 0;
        offset.current = wrap(offset.current + speed * dt);
        place();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [reduced]);

  // A horizontal trackpad swipe moves the bar. It must not also be the browser's back/forward swipe.
  // A vertical swipe is left alone, so the page still scrolls with the pointer over the bar.
  useEffect(() => {
    const el = viewport.current;
    if (!el || reduced) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      offset.current = wrap(offset.current + e.deltaX * (e.deltaMode === 1 ? 16 : 1));
      place();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [reduced]);

  const hold = () => {
    window.clearTimeout(resume.current);
    target.current = 0;
  };
  const go = () => {
    window.clearTimeout(resume.current);
    target.current = SPEED;
  };

  return (
    <div onPointerEnter={(e) => e.pointerType !== "touch" && hold()} onPointerLeave={(e) => e.pointerType !== "touch" && go()}>
      <div
        ref={viewport}
        role="region"
        aria-label="Pages and downloads"
        data-testid="marquee"
        className={cn(
          "marquee-bar relative cursor-grab pt-[22px] [overscroll-behavior-x:contain] [scrollbar-width:none] [touch-action:pan-y] [&::-webkit-scrollbar]:hidden active:cursor-grabbing",
          reduced ? "overflow-x-auto" : "overflow-hidden",
        )}
        style={
          {
            "--mq-w": ITEM_W,
            ...(reduced ? {} : { maskImage: "linear-gradient(to right, transparent, #000 3%, #000 97%, transparent)", WebkitMaskImage: "linear-gradient(to right, transparent, #000 3%, #000 97%, transparent)" }),
          } as CSSProperties
        }
        onPointerDown={(e) => {
          if (reduced || (e.pointerType === "mouse" && e.button !== 0)) return;
          drag.current = { x: e.clientX, from: offset.current, moved: false };
          if (e.pointerType === "touch") {
            hold();
            resume.current = window.setTimeout(go, 2500);
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) > 6) {
            d.moved = true;
            viewport.current?.setPointerCapture(e.pointerId);
          }
          if (d.moved) {
            offset.current = wrap(d.from - dx);
            place();
          }
        }}
        onPointerUp={() => {
          // A drag must not also be a click on the card under the pointer.
          if (drag.current?.moved) window.setTimeout(() => (drag.current = null), 0);
          else drag.current = null;
        }}
        onPointerCancel={() => (drag.current = null)}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onFocus={(e) => {
          hold();
          if (reduced) return;
          // The browser scrolls a clipped bar to show a focused card, which would knock the drift off. Undo that,
          // and slide the drift itself so the card sits near the left edge instead.
          if (viewport.current) viewport.current.scrollLeft = 0;
          const card = (e.target as HTMLElement).closest("li");
          const width = firstSet.current?.offsetWidth ?? 0;
          if (card && width > 0 && firstSet.current?.contains(card)) offset.current = Math.max(0, Math.min(width - 1, card.offsetLeft - 16));
        }}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && go()}
      >
        <div ref={track} data-testid="marquee-track" className="flex w-max will-change-transform">
          {Array.from({ length: copies }, (_, c) => (
            <ul key={c} ref={c === 0 ? firstSet : undefined} className="flex shrink-0" aria-hidden={c > 0 ? true : undefined}>
              {ITEMS.map((item) => (
                <li key={item.key} data-key={item.key}>
                  <Entry item={item} tabIndex={c > 0 ? -1 : 0} />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
