"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic } from "lucide-react";
import type { VoiceProfile } from "@/lib/voice";
import { cn } from "./format";
import { VoiceEngine } from "./voice-engine";
import { VoiceOrb, type OrbState } from "./VoiceOrb";
import { encodeWav, resampleTo } from "./wav";

const REQUEST_TIMEOUT_MS = 60_000;
const MIN_PHRASE_SECONDS = 0.5;

// Support can only be known in the browser. Subscribing fires one callback right after hydration, so React
// re-reads the snapshot and shows the controls. A no-op subscribe left the server's `false` in place on the
// prerendered page.
const subscribeOnce = (onChange: () => void) => {
  const id = window.setTimeout(onChange, 0);
  return () => window.clearTimeout(id);
};
function detectSupport() {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    window.isSecureContext
  );
}

type VoiceResponse =
  | { wake: false }
  | { wake: true; needsCommand: true }
  | { wake?: true; transcript: string; profile: VoiceProfile };

async function sendPhrase(samples: Float32Array, rate: number, mode: "wake" | "command"): Promise<VoiceResponse> {
  const wav = encodeWav(await resampleTo(samples, rate));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/voice-profile?mode=${mode}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav as BlobPart,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let message = `Voice input failed (HTTP ${res.status}).`;
      try {
        const body = await res.json();
        if (body?.error?.message) message = body.error.message;
      } catch { /* not JSON */ }
      throw new Error(message);
    }
    return (await res.json()) as VoiceResponse;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("Voice input took too long. Please try again.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

type Props = {
  disabled?: boolean;
  onResult: (profile: VoiceProfile, transcript: string) => void;
};

/**
 * "Hey Rauros" voice input.
 * - The mic button opens the orb and listens for one description (it ends on a pause, or tap the orb).
 * - "Listen for Hey Rauros" keeps the mic open. A local voice detector finds phrases; each one goes to Muse Voice
 *   Transcribe, and only phrases starting with "Hey Rauros" reach Muse Spark. Audio is never sent while it's quiet.
 */
export function VoiceInput({ disabled, onResult }: Props) {
  const supported = useSyncExternalStore(subscribeOnce, detectSupport, () => false);
  const [wakeOn, setWakeOn] = useState(false);
  const [orb, setOrb] = useState<OrbState | null>(null);
  const [orbText, setOrbText] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [heardSomething, setHeardSomething] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engine = useRef<VoiceEngine | null>(null);
  const wakeRef = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const clearClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  /** After the orb closes: back to wake listening if it's on, otherwise release the mic. */
  const settle = () => {
    clearClose();
    setOrb(null);
    setOrbText(null);
    if (wakeRef.current) engine.current?.setMode("wake");
    else void engine.current?.stop();
  };

  const closeLater = (ms: number) => {
    clearClose();
    closeTimer.current = window.setTimeout(settle, ms);
  };

  const fail = (message: string, inOrb: boolean) => {
    if (inOrb) {
      setOrb("error");
      setOrbText(message);
      closeLater(4500);
    } else {
      setError(message);
      if (wakeRef.current) engine.current?.setMode("wake");
    }
  };

  const handlePhrase = async (samples: Float32Array, rate: number, mode: "wake" | "command") => {
    setHeardSomething(false);
    if (samples.length / rate < MIN_PHRASE_SECONDS) {
      if (mode === "command") engine.current?.setMode("command");
      else engine.current?.setMode("wake");
      return;
    }
    if (mode === "command") {
      setOrb("processing");
      setOrbText(null);
    }
    try {
      const res = await sendPhrase(samples, rate, mode);
      if ("wake" in res && res.wake === false) {
        engine.current?.setMode("wake"); // not for us: keep listening quietly
        return;
      }
      if ("needsCommand" in res) {
        clearClose();
        setError(null);
        setOrb("listening");
        setOrbText(null);
        engine.current?.setMode("command");
        return;
      }
      onResultRef.current(res.profile ?? {}, res.transcript ?? "");
      setError(null);
      setOrb("done");
      setOrbText(res.transcript ? `“${res.transcript}”` : null);
      closeLater(2800);
    } catch (e) {
      fail(e instanceof Error ? e.message : "Voice input failed.", mode === "command");
    }
  };

  const getEngine = () => {
    engine.current ??= new VoiceEngine({
      onPhrase: (s, r, m) => void handlePhrase(s, r, m),
      onSpeechStart: (m) => (m === "command" ? setOrb("hearing") : setHeardSomething(true)),
      onIdle: () => settle(),
      onLevel: setLevel,
    });
    return engine.current;
  };

  const micError = (e: unknown) =>
    e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
      ? "Microphone access was blocked. Allow it in the browser's site settings, or type the profile."
      : "Couldn't start the microphone.";

  /** Mic button, or a detected "Hey Rauros" with nothing after it: open the orb and take one description. */
  const activate = async () => {
    setError(null);
    clearClose();
    setOrb("listening");
    setOrbText(null);
    try {
      await getEngine().start("command");
    } catch (e) {
      setOrb(null);
      setError(micError(e));
    }
  };

  const toggleWake = async () => {
    setError(null);
    if (wakeRef.current) {
      wakeRef.current = false;
      setWakeOn(false);
      setHeardSomething(false);
      if (!orb) await engine.current?.stop();
      return;
    }
    try {
      await getEngine().start(orb ? "command" : "wake");
      wakeRef.current = true;
      setWakeOn(true);
    } catch (e) {
      setError(micError(e));
    }
  };

  // Stop listening when the tab is hidden, and release the mic on unmount.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && wakeRef.current) {
        wakeRef.current = false;
        setWakeOn(false);
        setHeardSomething(false);
        void engine.current?.stop();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void engine.current?.stop();
    };
  }, []);

  if (!supported) return null;

  return (
    <>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={() => void activate()}
            disabled={disabled || orb === "processing"}
            aria-label="Hey Rauros: describe your company by voice"
            className="inline-flex items-center gap-2 border border-signal/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-signal transition hover:bg-signal hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Mic className="size-3.5" aria-hidden /> Hey Rauros
          </button>
          <button
            type="button"
            onClick={() => void toggleWake()}
            disabled={disabled}
            aria-pressed={wakeOn}
            title={wakeOn ? "Stop listening for “Hey Rauros”" : "Listen for “Hey Rauros” (keeps the mic on)"}
            className={cn(
              "inline-flex items-center gap-2 border border-l-0 px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition disabled:opacity-60",
              wakeOn ? "border-signal/50 bg-signal/10 text-signal" : "border-line-strong text-muted hover:text-foreground",
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", wakeOn ? (heardSomething ? "bg-signal" : "bg-signal blink") : "bg-dim")} />
            {wakeOn ? "Listening" : "Wake word"}
          </button>
        </div>
        <p role="status" aria-live="polite" className={cn("max-w-xs text-right text-[11px]", error ? "text-hold" : "text-dim")}>
          {error ?? (wakeOn ? (heardSomething ? "Heard something…" : "Say “Hey Rauros” anytime.") : "")}
        </p>
      </div>

      {orb && (
        <VoiceOrb
          state={orb}
          level={level}
          text={orbText}
          onPress={() => (orb === "listening" || orb === "hearing" ? engine.current?.finishNow() : settle())}
          onClose={settle}
        />
      )}
    </>
  );
}
