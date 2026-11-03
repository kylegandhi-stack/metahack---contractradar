"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import type { VoiceProfile } from "@/lib/voice";
import { cn } from "./format";
import { CAPTURE_WORKLET, concatFrames, encodeWav, resampleTo } from "./wav";

const MAX_SECONDS = 20;
const MIN_SECONDS = 0.6;
const REQUEST_TIMEOUT_MS = 60_000;

type Phase = "idle" | "starting" | "listening" | "processing" | "error";

const noopSubscribe = () => () => {};
// Module-level clock: event-handler timing only, kept out of the component body for the purity lint.
const now = () => performance.now();
function detectSupport() {
  return (
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    window.isSecureContext
  );
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error?.message) return body.error.message;
  } catch { /* not JSON */ }
  return `Voice input failed (HTTP ${res.status}).`;
}

type Props = {
  disabled?: boolean;
  onResult: (profile: VoiceProfile, transcript: string) => void;
};

/**
 * "Hey Rauros": click to talk, click again (or wait 20 s) to stop. Audio is captured in the browser, resampled
 * to 16 kHz mono WAV, and sent to /api/voice-profile, where Muse Voice Transcribe and Muse Spark do the work.
 */
export function VoiceInput({ disabled, onResult }: Props) {
  const supported = useSyncExternalStore(noopSubscribe, detectSupport, () => false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const rec = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    node: AudioWorkletNode;
    analyser: AnalyserNode;
    frames: Float32Array[];
    started: number;
    raf: number;
    stopTimer: number;
  } | null>(null);

  const teardown = async () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return null;
    cancelAnimationFrame(r.raf);
    clearTimeout(r.stopTimer);
    r.node.port.onmessage = null;
    r.node.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    const sampleRate = r.ctx.sampleRate;
    await r.ctx.close().catch(() => {});
    return { frames: r.frames, sampleRate, seconds: (now() - r.started) / 1000 };
  };

  // Release the mic if the component unmounts mid-recording.
  useEffect(() => () => void teardown(), []);

  const start = async () => {
    setError(null);
    setPhase("starting");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "rauros-capture");
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const frames: Float32Array[] = [];
      node.port.onmessage = (e: MessageEvent<Float32Array>) => frames.push(e.data);
      source.connect(node);
      source.connect(analyser);
      // The worklet must be pulled by the graph; route it to a muted gain so nothing is played back.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);

      const started = now();
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (!rec.current) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
        setElapsed((now() - started) / 1000);
        rec.current.raf = requestAnimationFrame(tick);
      };
      rec.current = {
        stream, ctx, node, analyser, frames, started,
        raf: requestAnimationFrame(tick),
        stopTimer: window.setTimeout(() => void stop(), MAX_SECONDS * 1000),
      };
      setPhase("listening");
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setError(denied ? "Microphone access was blocked. Allow it in the browser's site settings, or type the profile." : "Couldn't start the microphone.");
      setPhase("error");
    }
  };

  const stop = async () => {
    const captured = await teardown();
    setLevel(0);
    if (!captured) return;
    if (captured.seconds < MIN_SECONDS) {
      setError("That was too short. Click, speak, then click again.");
      setPhase("error");
      return;
    }
    setPhase("processing");
    try {
      const samples = await resampleTo(concatFrames(captured.frames), captured.sampleRate);
      const wav = encodeWav(samples);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch("/api/voice-profile", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav as BlobPart, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { transcript: string; profile: VoiceProfile };
      onResult(body.profile ?? {}, body.transcript ?? "");
      setPhase("idle");
    } catch (e) {
      setError(e instanceof DOMException && e.name === "AbortError" ? "Voice input took too long. Please try again." : e instanceof Error ? e.message : "Voice input failed.");
      setPhase("error");
    }
  };

  if (!supported) return null;

  const listening = phase === "listening";
  const busy = phase === "starting" || phase === "processing";
  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() => (listening ? void stop() : void start())}
        disabled={disabled || busy}
        aria-pressed={listening}
        aria-label={listening ? "Stop recording" : "Hey Rauros: describe your company by voice"}
        className={cn(
          "group inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-60",
          listening ? "border-hold/70 bg-hold/10 text-hold" : "border-signal/50 text-signal hover:bg-signal hover:text-background",
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : listening ? <Square className="size-3 fill-current" aria-hidden /> : <Mic className="size-3.5" aria-hidden />}
        {phase === "starting" ? "Opening mic" : phase === "processing" ? "Transcribing" : listening ? `Stop · ${Math.floor(elapsed)}s / ${MAX_SECONDS}s` : "Hey Rauros"}
        {listening && (
          <span className="ml-1 inline-flex h-3 items-end gap-[2px]" aria-hidden>
            {[0.2, 0.45, 0.7, 0.45, 0.2].map((w, i) => (
              <span key={i} className="w-[2px] bg-current" style={{ height: `${Math.max(2, Math.min(12, level * 12 * (1 - Math.abs(0.45 - w))))}px` }} />
            ))}
          </span>
        )}
      </button>
      <p role="status" aria-live="polite" className={cn("max-w-xs text-right text-[11px]", phase === "error" ? "text-hold" : "text-dim")}>
        {phase === "listening" && "Listening. Say your company name, what you make, and who you sell to."}
        {phase === "processing" && "Muse Voice is transcribing; Muse Spark is filling the form."}
        {phase === "error" && error}
      </p>
    </div>
  );
}
