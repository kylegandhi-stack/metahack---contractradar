// Zod schemas mirroring lib/types.ts. Limits for the request come from docs/interface.md.
import { z } from "zod";
import type {
  AgentEvent,
  AuditFinding,
  CompanyProfile,
  RankedResult,
  ResearchResponse,
  SourceRecord,
} from "./types";

export const CompanyProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  capabilities: z.string().trim().min(10).max(2000),
  smallBusiness: z.boolean().nullable().optional(),
  certifications: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  targetAgencies: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
});

export const ResearchRequestSchema = z.object({ profile: CompanyProfileSchema });

export const SourceRecordSchema = z
  .object({
    id: z.string().min(1),
    source: z.enum(["sam", "usaspending"]),
    kind: z.enum(["open_notice", "early_stage_notice", "historical_award"]),
    title: z.string().min(1),
    agency: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    url: z.url({ protocol: /^https$/ }),
    retrievedAt: z.iso.datetime(),
    postedAt: z.string().nullable().optional(),
    deadlineAt: z.string().nullable().optional(),
    awardAmount: z.number().nullable().optional(),
    setAside: z.string().nullable().optional(),
    naics: z.string().nullable().optional(),
    excerpts: z.array(z.object({ text: z.string().min(1), field: z.string().min(1) })),
    solicitationNumber: z.string().nullable().optional(),
    relatedNotices: z
      .array(
        z.object({
          id: z.string().min(1),
          kind: z.enum(["open_notice", "early_stage_notice", "historical_award"]),
          postedAt: z.string().nullable().optional(),
          url: z.url({ protocol: /^https$/ }),
        }),
      )
      .optional(),
    recipient: z.string().nullable().optional(),
  })
  .superRefine((record, ctx) => {
    if (record.kind === "historical_award") {
      if (record.source !== "usaspending") {
        ctx.addIssue({ code: "custom", message: "historical_award must come from USAspending" });
      }
      if (record.deadlineAt != null) {
        ctx.addIssue({ code: "custom", message: "historical_award cannot have a deadline" });
      }
    } else if (record.source !== "sam") {
      ctx.addIssue({ code: "custom", message: "notices must come from SAM.gov" });
    }
  });

export const AuditFindingSchema = z.object({
  severity: z.enum(["BLOCKER", "WARNING", "NOTE"]),
  issue: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidenceSourceId: z.string().nullable().optional(),
  evidenceExcerpt: z.string().nullable().optional(),
  correctiveAction: z.string().min(1),
});

const component = (max: number) => z.number().min(0).max(max).nullable();

export const RankedResultSchema = z.object({
  record: SourceRecordSchema,
  fitScore: z.number().min(0).max(100),
  fitBreakdown: z
    .object({
      technical: component(40),
      category: component(20),
      eligibility: component(20),
      execution: component(10),
      timing: component(10),
    })
    .optional(),
  confidence: z.enum(["low", "medium", "high"]),
  eligibility: z.enum(["meets_known_requirements", "needs_verification", "known_blocker"]),
  whyMatched: z.array(z.string()),
  blockers: z.array(z.string()),
  nextSteps: z.array(z.string()),
  findings: z.array(AuditFindingSchema),
  reviewStatus: z.enum(["APPROVED", "REVIEW_REQUIRED", "HOLD"]),
  priorAwards: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        recipient: z.string().nullable(),
        amount: z.number().nullable(),
        date: z.string().nullable(),
        url: z.url({ protocol: /^https$/ }),
      }),
    )
    .optional(),
});

export const AgentEventSchema = z.object({
  step: z.enum(["planner", "scout", "analyst", "strategist", "devils_advocate"]),
  status: z.enum(["started", "completed", "failed"]),
  timestamp: z.iso.datetime(),
  detail: z.string(),
});

export const ResearchResponseSchema = z.object({
  profile: CompanyProfileSchema,
  dataMode: z.enum(["live", "cached"]),
  cachedSources: z.array(z.enum(["sam", "usaspending"])).optional(),
  recordsUsed: z.number().int().min(0),
  results: z.array(RankedResultSchema),
  agentEvents: z.array(AgentEventSchema),
  runAt: z.iso.datetime(),
  warnings: z.array(z.string()),
});

export const VerifiedRecordsSchema = z.object({
  source: z.literal("usaspending"),
  retrievedAt: z.iso.datetime(),
  searchTerms: z.array(z.string()),
  records: z.array(SourceRecordSchema).min(1),
});

// Compile-time guard: fails the build if these schemas drift from the shared contract.
type Assignable<Sub extends Super, Super> = [Sub, Super];
export type ContractChecks = [
  Assignable<z.infer<typeof CompanyProfileSchema>, CompanyProfile>,
  Assignable<z.infer<typeof SourceRecordSchema>, SourceRecord>,
  Assignable<z.infer<typeof AuditFindingSchema>, AuditFinding>,
  Assignable<z.infer<typeof RankedResultSchema>, RankedResult>,
  Assignable<z.infer<typeof AgentEventSchema>, AgentEvent>,
  Assignable<z.infer<typeof ResearchResponseSchema>, ResearchResponse>,
];

export const SamSnapshotSchema = z.object({
  profiles: z.record(
    z.string(),
    z.object({
      retrievedAt: z.iso.datetime(),
      records: z.array(SourceRecordSchema),
      descriptions: z.record(z.string(), z.string()),
      shortened: z.array(z.string()),
    }),
  ),
});
