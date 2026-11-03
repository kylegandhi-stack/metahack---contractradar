import verified from "@/data/verified-records.json";
import { dedupeRecords, searchAwards, UsaSpendingError } from "@/lib/data/usaspending";
import { ResearchRequestSchema, ResearchResponseSchema, VerifiedRecordsSchema } from "@/lib/schemas";
import type {
  AgentEvent,
  CompanyProfile,
  RankedResult,
  ResearchError,
  ResearchErrorCode,
  SourceRecord,
} from "@/lib/types";

// No `runtime` export: next.config has cacheComponents on, which always uses Node.js and fails the
// build on `runtime = "nodejs"` ("not compatible with nextConfig.cacheComponents").
export const maxDuration = 120;

const MAX_TERMS = 6;
const MAX_RESULTS = 10;
const STOP = new Set(["and", "for", "the", "with", "maker", "person", "components", "systems"]);

function errorResponse(status: number, code: ResearchErrorCode, message: string) {
  const body: ResearchError = { error: { code, message } };
  return Response.json(body, { status });
}

function capabilityWords(capabilities: string): string[] {
  return [...new Set(capabilities.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [])].filter(
    (word) => !STOP.has(word),
  );
}

// Temporary, deterministic ranking used until the agent pipeline replaces it. Words shared with the
// capability statement only, so it reports a technical component and leaves the rest unknown.
function rank(records: SourceRecord[], profile: CompanyProfile): RankedResult[] {
  const words = capabilityWords(profile.capabilities);
  return records
    .map((record): RankedResult => {
      const text = `${record.title} ${record.description ?? ""}`.toLowerCase();
      const shared = words.filter((word) => text.includes(word));
      const technical = Math.min(shared.length * 10, 40);
      return {
        record,
        fitScore: technical,
        fitBreakdown: { technical, category: null, eligibility: null, execution: null, timing: null },
        confidence: "low",
        eligibility: "needs_verification",
        whyMatched: shared.length ? [`Shared terms: ${shared.join(", ")}`] : [],
        blockers: [],
        nextSteps: ["Open the source record and verify scope"],
        findings: [
          {
            severity: "WARNING",
            issue: "Keyword ranking only: no agent or Devil's Advocate review has run",
            whyItMatters: "A shared keyword does not establish a real capability match.",
            evidenceSourceId: null,
            evidenceExcerpt: null,
            correctiveAction: "Needs verification against the source record",
          },
        ],
        reviewStatus: "REVIEW_REQUIRED",
      };
    })
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, MAX_RESULTS);
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
  const { profile } = parsed.data;
  const warnings: string[] = [];
  const agentEvents: AgentEvent[] = [
    { step: "scout", status: "started", timestamp: new Date().toISOString(), detail: "Searching USAspending" },
  ];

  try {
    let dataMode: "live" | "cached" = "live";
    let records: SourceRecord[];
    try {
      const terms = capabilityWords(profile.capabilities).slice(0, MAX_TERMS);
      const batches = await Promise.all(terms.map((term) => searchAwards({ keywords: [term], limit: 5 })));
      records = dedupeRecords(batches.flat());
      if (records.length === 0) throw new UsaSpendingError("No records returned", null);
      agentEvents.push({
        step: "scout",
        status: "completed",
        timestamp: new Date().toISOString(),
        detail: `Retrieved ${records.length} USAspending records`,
      });
    } catch (error) {
      if (!(error instanceof UsaSpendingError)) throw error;
      const cache = VerifiedRecordsSchema.safeParse(verified);
      if (!cache.success) {
        return errorResponse(502, "UPSTREAM_ERROR", "USAspending is unavailable and no cache is usable");
      }
      dataMode = "cached";
      records = cache.data.records;
      warnings.push(`Live search failed (${error.message}). Showing cached public records.`);
      agentEvents.push({
        step: "scout",
        status: "failed",
        timestamp: new Date().toISOString(),
        detail: `${error.message}; using ${records.length} cached public records`,
      });
    }

    warnings.push("Early build: keyword ranking only. Agent review is not connected yet.");
    const response = ResearchResponseSchema.parse({
      profile,
      dataMode,
      recordsUsed: records.length,
      results: rank(records, profile),
      agentEvents,
      runAt: new Date().toISOString(),
      warnings,
    });
    return Response.json(response);
  } catch (error) {
    console.error("research route failed:", error instanceof Error ? error.name : "unknown");
    return errorResponse(500, "INTERNAL", "Unexpected server error");
  }
}
