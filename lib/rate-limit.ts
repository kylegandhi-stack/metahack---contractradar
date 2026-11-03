// Limits runs per IP and per day, so strangers can't spend the Meta credits behind a public URL.
// Counts live in this server instance's memory. On Vercel, each instance counts separately and a cold
// start resets them, so these limit abuse but aren't a hard spending cap.
const DEFAULT_PER_IP = 5;
const DEFAULT_WINDOW_MINUTES = 10;
const DEFAULT_DAILY = 50;
const DEFAULT_VOICE_DAILY = 50;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_TRACKED_IPS = 10_000;

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; scope: "ip" | "daily"; retryAfterSeconds: number };

// A number from the environment, with 0 turning that limit off. Anything invalid keeps the default.
function setting(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const ipRuns = new Map<string, number[]>();
// Research and voice count separately per day, so voice input can't use up research runs.
const research = { day: -1, runs: 0 };
const voice = { day: -1, runs: 0 };

export function resetRateLimits() {
  ipRuns.clear();
  for (const count of [research, voice]) {
    count.day = -1;
    count.runs = 0;
  }
}

// Only a run that is allowed uses up the limits, so a blocked caller can't exhaust the daily cap.
function check(ip: string, now: number, daily: number, count: { day: number; runs: number }): RateLimitResult {
  const perIp = setting("RATE_LIMIT_PER_IP", DEFAULT_PER_IP);
  const windowMs = (setting("RATE_LIMIT_WINDOW_MINUTES", DEFAULT_WINDOW_MINUTES) || DEFAULT_WINDOW_MINUTES) * MINUTE_MS;

  const recent = (ipRuns.get(ip) ?? []).filter((at) => now - at < windowMs);
  if (perIp > 0 && recent.length >= perIp) {
    ipRuns.set(ip, recent);
    return { allowed: false, scope: "ip", retryAfterSeconds: Math.ceil((recent[0] + windowMs - now) / 1000) };
  }

  const today = Math.floor(now / DAY_MS);
  if (today !== count.day) {
    count.day = today;
    count.runs = 0;
  }
  if (daily > 0 && count.runs >= daily) {
    return { allowed: false, scope: "daily", retryAfterSeconds: Math.ceil(((today + 1) * DAY_MS - now) / 1000) };
  }

  count.runs += 1;
  recent.push(now);
  ipRuns.set(ip, recent);
  // Keeps memory bounded if many addresses appear. Oldest entries go first.
  if (ipRuns.size > MAX_TRACKED_IPS) {
    const oldest = ipRuns.keys().next().value;
    if (oldest !== undefined) ipRuns.delete(oldest);
  }
  return { allowed: true };
}

export function checkRateLimit(ip: string, now = Date.now()): RateLimitResult {
  return check(ip, now, setting("RATE_LIMIT_DAILY", DEFAULT_DAILY), research);
}

export function checkVoiceRateLimit(ip: string, now = Date.now()): RateLimitResult {
  return check(`voice:${ip}`, now, setting("RATE_LIMIT_VOICE_DAILY", DEFAULT_VOICE_DAILY), voice);
}

// Vercel sets these itself. Elsewhere they can be spoofed, and callers without one share a bucket.
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
