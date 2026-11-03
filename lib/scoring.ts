// Relevance score, not a win probability. Unknown components stay null and add nothing to the total,
// so missing information can only lower a score.
import type { Confidence, FitBreakdown, ReviewStatus, SourceKind } from "./types";

const LIMITS = { technical: 40, category: 20, eligibility: 20, execution: 10, timing: 10 } as const;
const ORDER: Confidence[] = ["low", "medium", "high"];

function clamp(value: number | null | undefined, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(Math.max(Math.round(value), 0), max);
}

export function computeFit(
  raw: Partial<Record<keyof FitBreakdown, number | null>>,
  kind: SourceKind,
): { fitBreakdown: FitBreakdown; fitScore: number } {
  const historical = kind === "historical_award";
  const fitBreakdown: FitBreakdown = {
    technical: clamp(raw.technical, LIMITS.technical),
    category: clamp(raw.category, LIMITS.category),
    // A past award supports no eligibility or timing claim, whatever the model returned.
    eligibility: historical ? null : clamp(raw.eligibility, LIMITS.eligibility),
    execution: clamp(raw.execution, LIMITS.execution),
    timing: historical ? null : clamp(raw.timing, LIMITS.timing),
  };
  const fitScore = Object.values(fitBreakdown).reduce<number>((sum, part) => sum + (part ?? 0), 0);
  return { fitBreakdown, fitScore };
}

export function finalConfidence(modelConfidence: Confidence, status: ReviewStatus): Confidence {
  const ceiling: Confidence = status === "HOLD" ? "low" : status === "REVIEW_REQUIRED" ? "medium" : "high";
  return ORDER[Math.min(ORDER.indexOf(modelConfidence), ORDER.indexOf(ceiling))];
}
