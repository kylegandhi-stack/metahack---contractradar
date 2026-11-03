import { NoUsableDataError, RUN_CAP_MS, runResearch } from "@/lib/agents/orchestrator";
import { MetaError } from "@/lib/meta";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { ResearchRequestSchema } from "@/lib/schemas";
import type { ResearchError, ResearchErrorCode } from "@/lib/types";

// No `runtime` export: next.config has cacheComponents on, which always uses Node.js and fails the
// build on `runtime = "nodejs"` ("not compatible with nextConfig.cacheComponents").
export const maxDuration = 120;

function errorResponse(status: number, code: ResearchErrorCode, message: string, headers?: HeadersInit) {
  const body: ResearchError = { error: { code, message } };
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Request body must be JSON");
  }
  const parsed = ResearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "BAD_REQUEST", "Profile failed validation");
  }

  // After validation, so a malformed request costs nothing and uses no limit.
  const limit = checkRateLimit(clientIp(request.headers));
  if (!limit.allowed) {
    const message =
      limit.scope === "ip"
        ? `Too many runs from this address. Try again in about ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`
        : "This demo has reached its daily run limit. Please try again tomorrow.";
    return errorResponse(429, "RATE_LIMITED", message, { "Retry-After": String(limit.retryAfterSeconds) });
  }

  try {
    const response = await runResearch(parsed.data.profile, {
      signal: AbortSignal.timeout(RUN_CAP_MS),
    });
    return Response.json(response);
  } catch (error) {
    if (error instanceof MetaError) {
      // Safe to log: these messages hold an HTTP status or a fixed string, never the key or the profile.
      console.error("research route: Meta error:", error.code, error.message);
      if (error.code === "RATE_LIMITED") {
        return errorResponse(429, "RATE_LIMITED", "The AI service is busy. Please try again shortly.");
      }
      if (error.code === "TIMEOUT") {
        return errorResponse(504, "TIMEOUT", "Research took too long. Please try again.");
      }
      return errorResponse(502, "UPSTREAM_ERROR", "The AI service failed. Please try again.");
    }
    if (error instanceof NoUsableDataError) {
      return errorResponse(502, "UPSTREAM_ERROR", "Federal data sources are unavailable and no cache is usable.");
    }
    // The error name only: profiles must not end up in production logs.
    console.error("research route failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(500, "INTERNAL", "Unexpected server error");
  }
}
