import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST } from "../app/api/voice-profile/route";
import { encodeWav } from "../components/wav";
import { checkRateLimit, checkVoiceRateLimit, resetRateLimits } from "../lib/rate-limit";

const NOW = Date.UTC(2026, 10, 3, 20);
const saved = { ...process.env };

beforeEach(() => resetRateLimits());
afterEach(() => {
  process.env = { ...saved };
  resetRateLimits();
});

test("voice calls can't use up research runs", () => {
  process.env.RATE_LIMIT_VOICE_DAILY = "2";
  process.env.RATE_LIMIT_DAILY = "2";
  assert.equal(checkVoiceRateLimit("a", NOW).allowed, true);
  assert.equal(checkVoiceRateLimit("b", NOW).allowed, true);
  const blocked = checkVoiceRateLimit("c", NOW);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.allowed === false && blocked.scope, "daily");
  assert.equal(checkRateLimit("d", NOW).allowed, true);
});

test("research runs can't use up voice calls", () => {
  process.env.RATE_LIMIT_DAILY = "1";
  assert.equal(checkRateLimit("a", NOW).allowed, true);
  assert.equal(checkRateLimit("b", NOW).allowed, false);
  assert.equal(checkVoiceRateLimit("c", NOW).allowed, true);
});

test("the voice daily count resets the next UTC day, and 0 turns it off", () => {
  process.env.RATE_LIMIT_VOICE_DAILY = "1";
  assert.equal(checkVoiceRateLimit("a", NOW).allowed, true);
  assert.equal(checkVoiceRateLimit("b", NOW).allowed, false);
  assert.equal(checkVoiceRateLimit("c", NOW + 86_400_000).allowed, true);
  process.env.RATE_LIMIT_VOICE_DAILY = "0";
  assert.equal(checkVoiceRateLimit("d", NOW + 86_400_000).allowed, true);
});

test("the route enforces the voice daily count and leaves research runs alone", async () => {
  process.env.RATE_LIMIT_VOICE_DAILY = "1";
  process.env.RATE_LIMIT_DAILY = "1";
  delete process.env.MODEL_API_KEY; // fails before any network call
  const tone = Float32Array.from({ length: 16_000 }, (_, i) => 0.3 * Math.sin(i / 10));
  const post = (ip: string) =>
    POST(new Request("http://test/api/voice-profile", { method: "POST", headers: { "x-real-ip": ip }, body: encodeWav(tone) as BodyInit }));
  assert.equal((await post("a")).status, 502);
  assert.equal((await post("b")).status, 429);
  assert.equal(checkRateLimit("c").allowed, true);
});
