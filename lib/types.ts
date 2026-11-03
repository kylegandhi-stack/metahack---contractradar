// ContractRadar shared contract.
// Owner: Builder 1 authors; BOTH builders approve changes (PR label: contract-change).
// Source of truth for the shape of POST /api/research. See docs/interface.md.
// Do not change a field's name or meaning without a contract-change PR approved by both humans.

export type SourceKind = "open_notice" | "early_stage_notice" | "historical_award";
export type AuditSeverity = "BLOCKER" | "WARNING" | "NOTE";
export type ReviewStatus = "APPROVED" | "REVIEW_REQUIRED" | "HOLD";
export type Eligibility = "meets_known_requirements" | "needs_verification" | "known_blocker";
export type Confidence = "low" | "medium" | "high";
export type AgentStep = "planner" | "scout" | "analyst" | "strategist" | "devils_advocate";

export type CompanyProfile = {
  name: string;
  capabilities: string;
  smallBusiness?: boolean | null;
  certifications?: string[];
  targetAgencies?: string[];
};

export type SourceRecord = {
  id: string; // stable source identifier (USAspending generated_internal_id or SAM noticeId)
  source: "sam" | "usaspending";
  kind: SourceKind;
  title: string;
  agency?: string | null;
  description?: string | null;
  url: string; // official URL returned by / documented for the source. Never invented.
  retrievedAt: string; // ISO UTC
  postedAt?: string | null;
  deadlineAt?: string | null; // only for notices; always null for historical_award
  awardAmount?: number | null; // historical award obligation, NOT available budget
  setAside?: string | null;
  naics?: string | null;
  excerpts: { text: string; field: string }[]; // verbatim text from the source field named in `field`
  solicitationNumber?: string | null; // SAM notices only
  relatedNotices?: RelatedNotice[]; // other SAM postings of the same buy, collapsed into this record
  recipient?: string | null; // USAspending awards only: who won
};

export type RelatedNotice = {
  id: string; // SAM noticeId
  kind: SourceKind;
  postedAt?: string | null;
  url: string; // official source URL
};

// A past USAspending award from the same buyer. Facts from the record, never inferred.
export type PriorAward = {
  id: string; // USAspending generated_internal_id
  title: string;
  recipient: string | null;
  amount: number | null; // historical obligation, NOT available budget
  date: string | null;
  url: string; // official source URL
};

export type AuditFinding = {
  severity: AuditSeverity;
  issue: string;
  whyItMatters: string;
  evidenceSourceId?: string | null; // null only for missing-evidence warnings
  evidenceExcerpt?: string | null; // verbatim from the record when available
  correctiveAction: string;
};

// Additive to the runbook schema: separate score components so the UI can show a fit breakdown.
// Each component is null when the input needed to score it is unknown.
export type FitBreakdown = {
  technical: number | null; // 0-40
  category: number | null; // 0-20
  eligibility: number | null; // 0-20
  execution: number | null; // 0-10
  timing: number | null; // 0-10
};

export type RankedResult = {
  record: SourceRecord;
  fitScore: number; // 0-100 relevance score, NOT a win probability. UI label: "Historical relevance" when kind = historical_award
  fitBreakdown?: FitBreakdown;
  confidence: Confidence;
  eligibility: Eligibility;
  whyMatched: string[];
  blockers: string[];
  nextSteps: string[];
  findings: AuditFinding[]; // Devil's Advocate output, after deterministic gates
  reviewStatus: ReviewStatus;
  priorAwards?: PriorAward[]; // open and early-stage notices only: buyer history
};

export type AgentEvent = {
  step: AgentStep;
  status: "started" | "completed" | "failed";
  timestamp: string; // ISO UTC
  detail: string;
};

export type ResearchRequest = {
  profile: CompanyProfile;
};

export type ResearchResponse = {
  profile: CompanyProfile;
  dataMode: "live" | "cached"; // "cached" when any shown record comes from saved public data
  cachedSources?: ("sam" | "usaspending")[]; // which sources are saved in this run; absent when live
  recordsUsed: number;
  results: RankedResult[];
  agentEvents: AgentEvent[];
  runAt: string; // ISO UTC
  warnings: string[];
};

export type ResearchErrorCode = "BAD_REQUEST" | "RATE_LIMITED" | "UPSTREAM_ERROR" | "TIMEOUT" | "INTERNAL";

export type ResearchError = {
  error: { code: ResearchErrorCode; message: string };
};
