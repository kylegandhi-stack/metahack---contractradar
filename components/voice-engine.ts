/**
 * Microphone engine for "Hey Rauros". Audio stays in the browser until a local voice-activity detector hears
 * someone speak; only then is that phrase handed to `onPhrase` (and from there to Muse Voice Transcribe).
 * Plain class, outside React, so render stays pure.
 */
import { CAPTURE_WORKLET, concatFrames } from "./wav";

export type EngineMode = "wake" | "command" | "paused";

type Callbacks = {
  /** A finished phrase: mono Float32 samples at `sampleRate`. */
  onPhrase: (samples: Float32Array, sampleRate: number, mode: "wake" | "command") => void;
  onSpeechStart?: (mode: "wake" | "command") => void;
  /** In command mode, nobody spoke for a while. */
  onIdle?: () => void;
  onLevel?: (level: number) => void;
};

const WINDOW_MS = 20;
const START_MS = 140; // speech this long opens a phrase
const PRE_ROLL_MS = 350; // audio kept from just before speech, so the first syllable isn't clipped
const END_SILENCE_MS = { wake: 700, command: 1300 } as const;
const MAX_PHRASE_MS = 20_000;
const COMMAND_IDLE_MS = 7_000;
const MIN_THRESHOLD = 0.012;

export class VoiceEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private mode: EngineMode = "paused";

  private win: Float32Array[] = [];
  private winSamples = 0;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private phrase: Float32Array[] | null = null;
  private phraseSamples = 0;
  private speechMs = 0;
  private silenceMs = 0;
  private quietMs = 0;
  private floor = 0.004;

  constructor(private cb: Callbacks) {}

  get running() {
    return !!this.ctx;
  }

  async start(mode: Exclude<EngineMode, "paused">) {
    if (!this.ctx) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const source = ctx.createMediaStreamSource(this.stream);
      const node = new AudioWorkletNode(ctx, "rauros-capture");
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onFrame(e.data);
      source.connect(node);
      source.connect(analyser);
      const mute = ctx.createGain(); // the worklet must be pulled by the graph; play nothing back
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);
      this.ctx = ctx;
      this.node = node;
      this.analyser = analyser;
      this.loopLevel();
    }
    this.setMode(mode);
  }

  setMode(mode: EngineMode) {
    this.mode = mode;
    this.phrase = null;
    this.phraseSamples = 0;
    this.speechMs = 0;
    this.silenceMs = 0;
    this.quietMs = 0;
  }

  /** Ends the current command phrase now (the user clicked the orb). */
  finishNow() {
    if (this.mode !== "command") return;
    if (this.phrase && this.phraseSamples > 0) this.emit();
    else this.cb.onIdle?.();
  }

  async stop() {
    cancelAnimationFrame(this.raf);
    this.mode = "paused";
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.analyser = null;
    this.cb.onLevel?.(0);
  }

  private loopLevel() {
    const a = this.analyser;
    if (!a) return;
    const buf = new Float32Array(a.fftSize);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      this.cb.onLevel?.(Math.min(1, Math.sqrt(sum / buf.length) * 7));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private onFrame(frame: Float32Array) {
    if (this.mode === "paused" || !this.ctx) return;
    const rate = this.ctx.sampleRate;
    this.win.push(frame);
    this.winSamples += frame.length;
    if (this.winSamples < (rate * WINDOW_MS) / 1000) return;
    const chunk = concatFrames(this.win);
    this.win = [];
    this.winSamples = 0;

    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / chunk.length);
    const threshold = Math.max(MIN_THRESHOLD, this.floor * 3);
    const loud = rms > threshold;
    const mode = this.mode;

    if (!this.phrase) {
      // Not in a phrase: keep a short pre-roll, adapt to the room, and watch for speech.
      this.preRoll.push(chunk);
      this.preRollSamples += chunk.length;
      while (this.preRollSamples > (rate * PRE_ROLL_MS) / 1000 && this.preRoll.length > 1) {
        this.preRollSamples -= this.preRoll.shift()!.length;
      }
      if (!loud) this.floor = this.floor * 0.97 + rms * 0.03;
      this.speechMs = loud ? this.speechMs + WINDOW_MS : 0;
      if (mode === "command") {
        this.quietMs = loud ? 0 : this.quietMs + WINDOW_MS;
        if (this.quietMs >= COMMAND_IDLE_MS) {
          this.quietMs = 0;
          this.cb.onIdle?.();
          return;
        }
      }
      if (this.speechMs >= START_MS) {
        this.phrase = [...this.preRoll];
        this.phraseSamples = this.preRollSamples;
        this.preRoll = [];
        this.preRollSamples = 0;
        this.silenceMs = 0;
        this.cb.onSpeechStart?.(mode);
      }
      return;
    }

    this.phrase.push(chunk);
    this.phraseSamples += chunk.length;
    this.silenceMs = rms < threshold * 0.6 ? this.silenceMs + WINDOW_MS : 0;
    const tooLong = (this.phraseSamples / rate) * 1000 >= MAX_PHRASE_MS;
    if (this.silenceMs >= END_SILENCE_MS[mode] || tooLong) this.emit();
  }

  private emit() {
    if (!this.phrase || !this.ctx || this.mode === "paused") return;
    const samples = concatFrames(this.phrase);
    const mode = this.mode;
    const rate = this.ctx.sampleRate;
    this.setMode("paused"); // the owner resumes listening once the phrase is handled
    this.cb.onPhrase(samples, rate, mode);
  }
}
