import type { ReactNode } from "react";

/**
 * Diagrams for the Raspberry Pi guide. They are drawn here as SVG so the guide
 * has no image files to lose, and they mirror what each step looks like on screen
 * or on the bench. Swap one for a photo by replacing its <Figure> body with an <img>.
 */
export function Figure({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-card">
      <div role="img" aria-label={`${title}. ${caption}`}>
        {children}
      </div>
      <figcaption className="border-t border-line px-4 py-2 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}

const T = "font-sans";

/** Stations → LoRa → Pi → MQTT → your data. */
export function OverviewFigure() {
  const box = "fill-paper stroke-line";
  return (
    <svg viewBox="0 0 760 210" className="w-full" aria-hidden="true">
      <defs>
        <marker id="pi-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" className="fill-kelp" />
        </marker>
      </defs>
      {/* stations */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(24 ${24 + i * 56})`}>
          <rect width="120" height="44" rx="10" className={box} />
          <circle cx="22" cy="22" r="8" className="fill-kelp" />
          <text x="40" y="26" className={`${T} fill-ink text-[12px]`}>
            Station {i + 1}
          </text>
        </g>
      ))}
      {/* radio waves */}
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M156 ${46 + i * 56} C 200 ${46 + i * 56}, 200 105, 262 105`} fill="none" strokeDasharray="5 5" strokeWidth="2" className="stroke-kelp" markerEnd="url(#pi-arrow)" />
      ))}
      <text x="176" y="198" className={`${T} fill-muted text-[11px]`}>
        LoRa radio (915 MHz)
      </text>
      {/* pi */}
      <g transform="translate(270 62)">
        <rect width="150" height="86" rx="12" className="fill-kelp-deep" />
        <rect x="14" y="14" width="122" height="30" rx="5" className="fill-navy" />
        <text x="75" y="34" textAnchor="middle" className={`${T} fill-white text-[12px] font-semibold`}>
          Raspberry Pi
        </text>
        <text x="75" y="66" textAnchor="middle" className={`${T} fill-blue-100 text-[11px]`}>
          pi_lora.py
        </text>
      </g>
      <path d="M424 105 H 500" stroke="currentColor" strokeWidth="2" className="text-kelp" markerEnd="url(#pi-arrow)" />
      <text x="436" y="96" className={`${T} fill-muted text-[11px]`}>
        MQTT
      </text>
      {/* broker + data */}
      <g transform="translate(506 62)">
        <rect width="120" height="86" rx="12" className={box} />
        <text x="60" y="38" textAnchor="middle" className={`${T} fill-ink text-[12px] font-semibold`}>
          MQTT broker
        </text>
        <text x="60" y="58" textAnchor="middle" className={`${T} fill-muted text-[11px]`}>
          sensors/&lt;station&gt;
        </text>
      </g>
      <path d="M630 105 H 676" stroke="currentColor" strokeWidth="2" className="text-kelp" markerEnd="url(#pi-arrow)" />
      <g transform="translate(680 82)">
        <rect width="64" height="46" rx="10" className="fill-moss stroke-line" />
        <path d="M12 34 L24 22 L34 28 L52 12" fill="none" strokeWidth="2.5" className="stroke-kelp" />
      </g>
    </svg>
  );
}

/** Raspberry Pi Imager, drawn as the three choices and the settings it asks for. */
export function ImagerFigure({ user, hostname }: { user: string; hostname: string }) {
  const row = (y: number, label: string, value: string) => (
    <g transform={`translate(24 ${y})`}>
      <rect width="260" height="40" rx="8" className="fill-card stroke-line" />
      <text x="14" y="17" className={`${T} fill-muted text-[10px]`}>
        {label}
      </text>
      <text x="14" y="32" className={`${T} fill-ink text-[12px] font-semibold`}>
        {value}
      </text>
    </g>
  );
  const field = (y: number, label: string, value: string, tick = false) => (
    <g transform={`translate(330 ${y})`}>
      <text x="0" y="12" className={`${T} fill-muted text-[10px]`}>
        {label}
      </text>
      <rect y="18" width="250" height="26" rx="6" className="fill-paper stroke-line" />
      <text x="10" y="35" className={`${T} fill-ink text-[12px]`}>
        {tick ? "✓  " : ""}
        {value}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 620 330" className="w-full" aria-hidden="true">
      <rect x="6" y="6" width="608" height="318" rx="12" className="fill-paper-deep stroke-line" />
      <rect x="6" y="6" width="608" height="30" rx="12" className="fill-line" />
      <text x="24" y="26" className={`${T} fill-ink text-[12px] font-semibold`}>
        Raspberry Pi Imager
      </text>
      <text x="24" y="62" className={`${T} fill-kelp-deep text-[11px] font-semibold`}>
        1. Pick three things
      </text>
      {row(70, "Raspberry Pi device", "Your model (Pi 4, Pi 3, Zero 2 W…)")}
      {row(120, "Operating system", "Raspberry Pi OS Lite (64-bit)")}
      {row(170, "Storage", "Your microSD card")}
      <rect x="24" y="230" width="260" height="38" rx="19" className="fill-kelp" />
      <text x="154" y="254" textAnchor="middle" className={`${T} fill-white text-[13px] font-semibold`}>
        Next: edit settings
      </text>
      <text x="330" y="62" className={`${T} fill-kelp-deep text-[11px] font-semibold`}>
        2. OS customisation
      </text>
      {field(70, "Hostname", `${hostname}.local`)}
      {field(120, "Username", user)}
      {field(170, "Password", "••••••••••")}
      {field(220, "Wi-Fi (skip if you use a cable)", "Your network name")}
      {field(270, "Services", "Enable SSH (use password)", true)}
    </svg>
  );
}

/** The LoRa bonnet pressed onto the Pi's 40-pin header. */
export function BonnetFigure() {
  return (
    <svg viewBox="0 0 620 300" className="w-full" aria-hidden="true">
      {/* Pi */}
      <rect x="60" y="120" width="360" height="150" rx="14" className="fill-emerald-700" />
      <rect x="380" y="140" width="64" height="48" rx="3" className="fill-neutral-300 stroke-neutral-500" />
      <rect x="380" y="200" width="64" height="48" rx="3" className="fill-neutral-300 stroke-neutral-500" />
      <text x="412" y="168" textAnchor="middle" className={`${T} fill-neutral-700 text-[10px]`}>
        USB
      </text>
      <text x="412" y="228" textAnchor="middle" className={`${T} fill-neutral-700 text-[10px]`}>
        USB
      </text>
      <rect x="130" y="150" width="70" height="70" rx="4" className="fill-neutral-800" />
      <text x="165" y="190" textAnchor="middle" className={`${T} fill-neutral-300 text-[10px]`}>
        CPU
      </text>
      <rect x="70" y="252" width="60" height="14" rx="3" className="fill-neutral-300" />
      <text x="100" y="263" textAnchor="middle" className={`${T} fill-neutral-700 text-[8px]`}>
        power
      </text>
      {/* header pins */}
      {Array.from({ length: 20 }, (_, i) => (
        <g key={i}>
          <rect x={92 + i * 10} y="124" width="6" height="6" className="fill-yellow-500" />
          <rect x={92 + i * 10} y="133" width="6" height="6" className="fill-yellow-500" />
        </g>
      ))}
      {/* bonnet */}
      <g className="[transform-box:fill-box]" transform="translate(70 52)">
        <rect width="220" height="86" rx="10" className="fill-kelp-deep" />
        <rect x="14" y="14" width="68" height="34" rx="3" className="fill-navy stroke-blue-200" />
        <text x="48" y="35" textAnchor="middle" className={`${T} fill-blue-100 text-[9px]`}>
          OLED
        </text>
        <rect x="100" y="16" width="46" height="30" rx="3" className="fill-neutral-200" />
        <text x="123" y="35" textAnchor="middle" className={`${T} fill-neutral-700 text-[9px]`}>
          RFM95
        </text>
        <circle cx="190" cy="30" r="9" className="fill-yellow-500 stroke-yellow-700" />
        <text x="110" y="72" textAnchor="middle" className={`${T} fill-blue-100 text-[10px]`}>
          LoRa Radio Bonnet, 915 MHz
        </text>
      </g>
      {/* antenna */}
      <path d="M260 82 C 300 70, 310 40, 300 10" fill="none" strokeWidth="3" className="stroke-neutral-500" />
      <rect x="294" y="0" width="12" height="18" rx="4" className="fill-neutral-700" />
      <text x="320" y="20" className={`${T} fill-ink text-[11px]`}>
        Screw the antenna on first
      </text>
      {/* press arrow */}
      <path d="M180 142 V 132" stroke="currentColor" strokeWidth="3" className="text-kelp" />
      <path d="M172 140 L180 150 L188 140" fill="none" strokeWidth="3" className="stroke-kelp" />
      <text x="454" y="100" className={`${T} fill-ink text-[11px] font-semibold`}>
        With the Pi powered OFF,
      </text>
      <text x="454" y="116" className={`${T} fill-ink text-[11px]`}>
        press the bonnet straight
      </text>
      <text x="454" y="132" className={`${T} fill-ink text-[11px]`}>
        down onto all 40 pins.
      </text>
    </svg>
  );
}

/** What a healthy gateway shows. Mirrors the gateway's own log lines. */
export function TerminalFigure({ user, hostname }: { user: string; hostname: string }) {
  const line = (y: number, text: string, cls = "fill-neutral-200") => (
    <text x="18" y={y} className={`font-mono ${cls} text-[11px]`}>
      {text}
    </text>
  );
  return (
    <svg viewBox="0 0 680 250" className="w-full" aria-hidden="true">
      <rect x="4" y="4" width="672" height="242" rx="10" className="fill-neutral-900" />
      <circle cx="22" cy="20" r="5" className="fill-red-400" />
      <circle cx="40" cy="20" r="5" className="fill-yellow-400" />
      <circle cx="58" cy="20" r="5" className="fill-green-400" />
      {line(48, `${user}@${hostname}:~ $ systemctl status lora-gateway`, "fill-neutral-400")}
      {line(70, "● lora-gateway.service - LoRa Gateway Service")}
      {line(88, "     Loaded: loaded (/etc/systemd/system/lora-gateway.service; enabled)")}
      {line(106, "     Active: active (running) since …", "fill-green-400")}
      {line(130, `${user}@${hostname}:~ $ journalctl -u lora-gateway -f`, "fill-neutral-400")}
      {line(152, "[info]: I2C initialized")}
      {line(168, "[info]: SSD1306 OLED display initialized")}
      {line(184, "[info]: Loaded pi_config.json")}
      {line(200, "[info]: Connected to MQTT broker at … :1883", "fill-green-400")}
      {line(216, "[info]: Received LoRa packet: {…}")}
      {line(232, "[info]: Forwarded message for <station> to sensors/<station>")}
    </svg>
  );
}
