import { MetaError, RunBudget } from "@/lib/meta";
import { checkVoiceRateLimit, clientIp } from "@/lib/rate-limit";
import type { ResearchError, ResearchErrorCode } from "@/lib/types";
import { checkWakeLimit, wakeEnabled, extractVoiceProfile, hasCommand, inspectWav, MAX_VOICE_BYTES, splitWakePhrase, transcribe, VoiceInputError } from "@/lib/voice";

// POST /api/voice-profile[?mode=command|wake]: body is a mono 16-bit PCM WAV (16 or 24 kHz, at most 25 s).
// command (default): Muse Voice Transcribe -> transcript, then Muse Spark -> CompanyProfile fields.
// wake: Muse Voice Transcribe only, unless the phrase starts with "Hey Rauros". Without it, the response is
// { wake: false } and nothing else runs; with it, the words after it are structured as in command mode.
// No SAM.gov or USAspending calls.
// No `runtime` export: cacheComponents always uses Node.js and rejects `runtime = "nodejs"`.
export const maxDuration = 60;

const TRANSCRIBE_TIMEOUT_MS = 20_000;
const EXTRACT_TIMEOUT_MS = 25_000;

function errorResponse(status: number, code: ResearchErrorCode, message: string, headers?: HeadersInit) {
  const body: ResearchError = { error: { code, message } };
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  // Wake mode is off unless VOICE_WAKE=on: refuse before reading the body, so it costs nothing.
  if (new URL(request.url).searchParams.get("mode") === "wake" && !wakeEnabled()) {
    return errorResponse(404, "BAD_REQUEST", "The wake word is turned off on this deployment.");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_VOICE_BYTES) return errorResponse(413, "BAD_REQUEST", "Recording is too large. Keep it under 20 seconds.");

  let wav: Uint8Array;
  try {
    wav = new Uint8Array(await request.arrayBuffer());
    inspectWav(wav);
  } catch (error) {
    const message = error instanceof VoiceInputError ? error.message : "Could not read the recording.";
    return errorResponse(400, "BAD_REQUEST", message);
  }

  const mode = new URL(request.url).searchParams.get("mode") === "wake" ? "wake" : "command";
  const ip = clientIp(request.headers);
  // Wake checks run on every phrase while listening, so they have their own generous window. Commands use a
  // separate bucket and daily count from research runs, so trying the mic doesn't use up searches.
  const limit = mode === "wake" ? checkWakeLimit(ip) : checkVoiceRateLimit(ip);
  if (!limit.allowed) {
    return errorResponse(429, "RATE_LIMITED", "Too many voice requests. Try again in a few minutes.", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const started = Date.now();
  try {
    const heard = await transcribe(wav, AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS));
    const { audioDurationMs } = heard;
    let transcript = heard.transcript;
    if (mode === "wake") {
      const { woke, rest } = splitWakePhrase(transcript);
      // Not addressed to us: return nothing about what was said and make no Muse Spark call.
      if (!woke) return Response.json({ wake: false });
      if (!hasCommand(rest)) return Response.json({ wake: true, needsCommand: true });
      transcript = rest;
    } else {
      // A command recorded after "Hey Rauros" may repeat it; drop it so it never lands in the form.
      const { woke, rest } = splitWakePhrase(transcript);
      if (woke && hasCommand(rest)) transcript = rest;
    }
    if (!transcript) return errorResponse(422, "BAD_REQUEST", "No speech was recognized. Try again a little closer to the mic.");
    const transcribedMs = Date.now() - started;

    const budget = new RunBudget(AbortSignal.timeout(EXTRACT_TIMEOUT_MS));
    const profile = await extractVoiceProfile(transcript, budget);
    // Counts and durations only: never audio, transcript text or the key.
    console.info("voice profile", JSON.stringify({ mode, audioDurationMs, transcribedMs, totalMs: Date.now() - started, fields: Object.keys(profile), ...budget.summary() }));
    return Response.json({ ...(mode === "wake" ? { wake: true } : {}), transcript, profile, models: { transcription: "muse-voice-transcribe-1.0", extraction: "muse-spark-1.3" } });
  } catch (error) {
    if (error instanceof MetaError) {
      console.error("voice profile: Meta error:", error.code, error.message);
      if (error.code === "RATE_LIMITED") return errorResponse(429, "RATE_LIMITED", "The voice service is busy. Please try again shortly.");
      if (error.code === "TIMEOUT") return errorResponse(504, "TIMEOUT", "Voice input took too long. Please try again.");
      return errorResponse(502, "UPSTREAM_ERROR", "The voice service failed. Please try again or type the profile.");
    }
    console.error("voice profile failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(500, "INTERNAL", "Unexpected server error");
  }
}
