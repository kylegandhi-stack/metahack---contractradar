"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "./format";

export type OrbState = "listening" | "hearing" | "processing" | "done" | "error";

const CAPTION: Record<OrbState, string> = {
  listening: "Listening. Tell me your company, what you make and who you sell to.",
  hearing: "Listening…",
  processing: "Muse Voice is transcribing · Muse Spark is filling the form",
  done: "Form filled. Check the fields, then run research.",
  error: "",
};

/**
 * Siri-style voice orb. Three blurred colour fields orbit a dark core; their size follows the live mic level, and
 * the whole orb breathes while Muse is working. Click it (or press Esc) to finish speaking or dismiss.
 */
export function VoiceOrb({
  state,
  level,
  text,
  onPress,
  onClose,
}: {
  state: OrbState;
  level: number;
  text?: string | null;
  onPress: () => void;
  onClose: () => void;
}) {
  const live = state === "listening" || state === "hearing";
  const amp = live ? Math.min(1, level) : state === "processing" ? 0.35 : 0.15;
  const scale = (base: number, k: number) => base + amp * k;

  // Portal to <body>: the form panel's backdrop-filter would otherwise trap this fixed layer inside it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-3 px-4" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="orb-pop pointer-events-auto relative">
        <button
          type="button"
          onClick={onPress}
          aria-label={live ? "Finish speaking" : "Dismiss voice assistant"}
          className={cn("orb relative block size-36 rounded-full focus:outline-none", state === "processing" && "orb-breathe", state === "error" && "orb-error")}
        >
          <span aria-hidden className="orb-field orb-a" style={{ transform: `scale(${scale(0.9, 0.55)})` }} />
          <span aria-hidden className="orb-field orb-b" style={{ transform: `scale(${scale(0.85, 0.7)})` }} />
          <span aria-hidden className="orb-field orb-c" style={{ transform: `scale(${scale(0.8, 0.45)})` }} />
          <span aria-hidden className="absolute inset-[22%] rounded-full bg-background/85 shadow-[inset_0_0_24px_rgba(255,255,255,0.08)] ring-1 ring-white/15" />
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <span className="flex h-6 items-center gap-[3px]">
              {[0.35, 0.7, 1, 0.7, 0.35].map((w, i) => (
                <span
                  key={i}
                  className={cn("w-[3px] rounded-full bg-foreground/90", !live && "orb-bar")}
                  style={{ height: live ? `${Math.max(3, Math.min(24, 3 + level * 30 * w))}px` : undefined, animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close voice assistant"
          className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full border border-line-strong bg-background/90 text-muted transition hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div role="status" aria-live="polite" className="orb-pop pointer-events-auto max-w-lg rounded-2xl border border-line-strong bg-background/85 px-4 py-2.5 text-center shadow-2xl backdrop-blur-md">
        <p className="label text-signal">Hey Rauros</p>
        <p className={cn("mt-1 text-sm leading-snug", state === "error" ? "text-hold" : "text-foreground/90")}>{text || CAPTION[state]}</p>
        {live && <p className="mt-1 text-[11px] text-dim">Pause when you&apos;re done, or tap the orb.</p>}
      </div>
    </div>,
    document.body,
  );
}
