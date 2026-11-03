// Pure metrics for the eval runner. Labels come from people, never from a model.
import { z } from "zod";
import { CompanyProfileSchema } from "./schemas";
import type { RankedResult } from "./types";

// Hand labels list each record with a reason. Award-history keys list what a real supplier won.
export const EvalFileSchema = z.object({
  profile: z.union([z.string(), CompanyProfileSchema]),
  companyProfile: CompanyProfileSchema.optional(),
  source: z.enum(["hand_label", "award_history"]),
  labels: z
    .array(z.object({ id: z.string(), label: z.enum(["relevant", "not_relevant"]), reason: z.string().optional() }))
    .optional(),
  relevantIds: z.array(z.string()).optional(),
  notRelevantIds: z.array(z.string()).optional(),
});
export type EvalFile = z.infer<typeof EvalFileSchema>;

export type EvalMetrics = {
  // Precision over labeled records only, so null when no top-5 record has a label.
  precisionAt5: number | null;
  top5Labeled: number;
  top5Relevant: number;
  top5Unlabeled: number;
  recallAt10: number | null;
  relevantFoundIn10: number;
  relevantTotal: number;
  expiredNotices: number;
  expiredOnHold: number;
  expiredHoldRate: number | null;
};

export function computeMetrics(file: EvalFile, results: RankedResult[], now: number): EvalMetrics {
  const relevant = new Set([
    ...(file.relevantIds ?? []),
    ...(file.labels ?? []).filter((entry) => entry.label === "relevant").map((entry) => entry.id),
  ]);
  const notRelevant = new Set([
    ...(file.notRelevantIds ?? []),
    ...(file.labels ?? []).filter((entry) => entry.label === "not_relevant").map((entry) => entry.id),
  ]);
  const ids = results.map((result) => result.record.id);
  const top5 = ids.slice(0, 5);
  const top5Relevant = top5.filter((id) => relevant.has(id)).length;
  const top5Labeled = top5.filter((id) => relevant.has(id) || notRelevant.has(id)).length;
  const relevantFoundIn10 = ids.slice(0, 10).filter((id) => relevant.has(id)).length;
  const expired = results.filter((result) => {
    const deadline = result.record.deadlineAt ? Date.parse(result.record.deadlineAt) : Number.NaN;
    return !Number.isNaN(deadline) && deadline <= now;
  });
  const expiredOnHold = expired.filter((result) => result.reviewStatus === "HOLD").length;
  return {
    precisionAt5: top5Labeled > 0 ? top5Relevant / top5Labeled : null,
    top5Labeled,
    top5Relevant,
    top5Unlabeled: top5.length - top5Labeled,
    recallAt10: relevant.size > 0 ? relevantFoundIn10 / relevant.size : null,
    relevantFoundIn10,
    relevantTotal: relevant.size,
    expiredNotices: expired.length,
    expiredOnHold,
    expiredHoldRate: expired.length > 0 ? expiredOnHold / expired.length : null,
  };
}
