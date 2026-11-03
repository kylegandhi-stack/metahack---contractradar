/**
 * Browser-side audio helpers for "Hey Rauros". Muse Voice Transcribe accepts mono 16-bit PCM WAV at 16 or 24 kHz,
 * so the recorder resamples whatever the mic delivers to 16 kHz and wraps it in a RIFF/WAVE header.
 */
export const TARGET_SAMPLE_RATE = 16_000;

/** Concatenates captured Float32 frames. */
export function concatFrames(frames: Float32Array[]): Float32Array {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const f of frames) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}

/** Linear-interpolation resampler. Good enough for speech; used when OfflineAudioContext isn't available. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = pos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/** Resamples with the browser's own (band-limited) resampler when it can, falling back to linear. */
export async function resampleTo(input: Float32Array, fromRate: number, toRate = TARGET_SAMPLE_RATE): Promise<Float32Array> {
  if (fromRate === toRate) return input;
  const Offline = typeof window !== "undefined" ? window.OfflineAudioContext : undefined;
  if (!Offline) return resampleLinear(input, fromRate, toRate);
  try {
    const length = Math.max(1, Math.ceil((input.length * toRate) / fromRate));
    const ctx = new Offline(1, length, toRate);
    const buffer = ctx.createBuffer(1, input.length, fromRate);
    buffer.copyToChannel(input as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0).slice();
  } catch {
    return resampleLinear(input, fromRate, toRate);
  }
}

/** Mono 16-bit little-endian PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const write = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/** AudioWorklet that forwards channel 0 of each render quantum to the main thread. Loaded from a Blob URL. */
export const CAPTURE_WORKLET = `
class RaurosCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("rauros-capture", RaurosCapture);
`;
