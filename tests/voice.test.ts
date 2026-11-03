import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeWav, resampleLinear } from "../components/wav";
import { MetaError } from "../lib/meta";
import { inspectWav, normalizeVoiceProfile, transcribe, transcribeSettings, VOICE_MODEL, VoiceInputError } from "../lib/voice";

const tone = (seconds: number, rate = 16_000) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.3 * Math.sin(i / 10));

test("browser WAV encoder output passes the server's WAV check", () => {
  const info = inspectWav(encodeWav(tone(2)));
  assert.deepEqual(info, { sampleRate: 16_000, channels: 1, bitsPerSample: 16, durationSeconds: 2 });
});

test("inspectWav rejects what Muse Voice can't take, and our own limits", () => {
  assert.throws(() => inspectWav(new TextEncoder().encode("not a wav file at all, definitely not one!!!!!!")), VoiceInputError);
  assert.throws(() => inspectWav(encodeWav(tone(0.2))), /too short/);
  assert.throws(() => inspectWav(encodeWav(tone(30))), /too (long|large)/);
  const wrongRate = encodeWav(tone(1, 44_100), 44_100);
  assert.throws(() => inspectWav(wrongRate), /16 or 24 kHz/);
  const stereo = encodeWav(tone(1));
  new DataView(stereo.buffer).setUint16(22, 2, true);
  assert.throws(() => inspectWav(stereo), /mono/);
});

test("resampler keeps duration when converting 48 kHz to 16 kHz", () => {
  const out = resampleLinear(tone(1, 48_000), 48_000, 16_000);
  assert.equal(out.length, 16_000);
});

test("transcribe settings follow Meta's documented push-to-talk request", () => {
  const s = transcribeSettings();
  assert.equal(s.model, VOICE_MODEL);
  assert.equal(s.model, "muse-voice-transcribe-1.0");
  assert.equal(s.audioEncoding, "WAV");
  assert.equal(s.mode, "PUSH_TO_TALK");
  assert.ok(s.keywords.includes("hydrophone"));
});

test("transcribe sends a multipart request with the key in the header and maps errors", async () => {
  const saved = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
  try {
    let seen: { url: string; auth: string | null; parts: string[] } | null = null;
    const ok: typeof fetch = async (url, init) => {
      const body = init?.body as FormData;
      seen = { url: String(url), auth: new Headers(init?.headers).get("authorization"), parts: [...body.keys()] };
      return Response.json({ sessionId: "s1", transcript: "  We make hydrophones.  ", audioDurationMs: 2000 });
    };
    const result = await transcribe(encodeWav(tone(2)), undefined, ok);
    assert.equal(result.transcript, "We make hydrophones.");
    assert.equal(seen!.url, "https://api.meta.ai/v1/asr/transcribe");
    assert.equal(seen!.auth, "Bearer test-key");
    assert.deepEqual(seen!.parts, ["request", "audio"]);

    const busy: typeof fetch = async () => new Response("{}", { status: 429 });
    await assert.rejects(transcribe(encodeWav(tone(2)), undefined, busy), (e: unknown) => e instanceof MetaError && e.code === "RATE_LIMITED");
    const broken: typeof fetch = async () => new Response("{}", { status: 500 });
    await assert.rejects(transcribe(encodeWav(tone(2)), undefined, broken), (e: unknown) => e instanceof MetaError && e.code === "UPSTREAM_ERROR");
    const weird: typeof fetch = async () => Response.json({ nope: true });
    await assert.rejects(transcribe(encodeWav(tone(2)), undefined, weird), /unexpected response/);
  } finally {
    if (saved === undefined) delete process.env.MODEL_API_KEY;
    else process.env.MODEL_API_KEY = saved;
  }
});

test("normalizeVoiceProfile keeps only what was said and never invents fields", () => {
  const transcript = "AquaVector Systems, twelve people, we build hydrophones and underwater acoustic sensors for the Navy.";
  const p = normalizeVoiceProfile(
    { name: " AquaVector  Systems ", capabilities: "12-person maker of hydrophones and underwater acoustic sensors.", smallBusiness: true, certifications: [], targetAgencies: ["Department of the Navy", "Department of the Navy", " "] },
    transcript,
  );
  assert.deepEqual(p, {
    name: "AquaVector Systems",
    capabilities: "12-person maker of hydrophones and underwater acoustic sensors.",
    smallBusiness: true,
    targetAgencies: ["Department of the Navy"],
  });

  const sparse = normalizeVoiceProfile({ name: null, capabilities: null, smallBusiness: null, certifications: [], targetAgencies: [] }, "We machine radar antenna housings.");
  assert.deepEqual(sparse, { capabilities: "We machine radar antenna housings." }, "falls back to the speaker's own words, nothing else");

  const empty = normalizeVoiceProfile({ name: null, capabilities: null, smallBusiness: null, certifications: [], targetAgencies: [] }, "um");
  assert.deepEqual(empty, {});
});

test("voice route rejects bad audio before any model call, and reports a missing key", async () => {
  const saved = process.env.MODEL_API_KEY;
  delete process.env.MODEL_API_KEY;
  try {
    const { POST } = await import("../app/api/voice-profile/route");
    const bad = await POST(new Request("http://x/api/voice-profile", { method: "POST", body: "hello" }));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, "BAD_REQUEST");

    const wav = encodeWav(tone(2));
    const noKey = await POST(new Request("http://x/api/voice-profile", { method: "POST", body: wav as BlobPart, headers: { "x-forwarded-for": "203.0.113.9" } }));
    assert.equal(noKey.status, 502);
    assert.equal((await noKey.json()).error.code, "UPSTREAM_ERROR");
  } finally {
    if (saved !== undefined) process.env.MODEL_API_KEY = saved;
  }
});
