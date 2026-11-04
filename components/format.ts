import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { AgentEvent, RankedResult, ReviewStatus, SourceKind } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UNKNOWN = "Not provided";

export function fmtDate(value?: string | null): string {
  if (!value) return UNKNOWN;
  // Date-only strings (YYYY-MM-DD) render in UTC so they never shift a day; full timestamps render in local time.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}) });
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return UNKNOWN;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

export function fmtMoney(value?: number | null): string {
  if (value === null || value === undefined) return UNKNOWN;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function orUnknown(value?: string | null): string {
  return value && value.trim() ? value : UNKNOWN;
}

export const KIND_LABEL: Record<SourceKind, string> = {
  open_notice: "Open notice",
  early_stage_notice: "Early-stage notice",
  historical_award: "Historical award",
};

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  APPROVED: "Approved",
  REVIEW_REQUIRED: "Review required",
  HOLD: "Hold — do not pursue as presented",
};

export const ELIGIBILITY_LABEL: Record<RankedResult["eligibility"], string> = {
  meets_known_requirements: "Meets known requirements",
  needs_verification: "Needs verification",
  known_blocker: "Known blocker",
};

export const STEP_LABEL: Record<AgentEvent["step"], string> = {
  planner: "Research Planner",
  scout: "Opportunity Scout",
  analyst: "Qualification Analyst",
  strategist: "Pursuit Strategist",
  devils_advocate: "Devil's Advocate",
};

export const STEP_ORDER: AgentEvent["step"][] = ["planner", "scout", "analyst", "strategist", "devils_advocate"];

export const isHistorical = (r: RankedResult) => r.record.kind === "historical_award";

export function sourceName(source: "sam" | "usaspending") {
  return source === "sam" ? "SAM.gov" : "USAspending.gov";
}

/**
 * A notice whose response deadline has passed. Date-only deadlines count through the end of that UTC day.
 * Historical awards never expire (they have no deadline).
 */
export function isExpired(r: RankedResult, now: Date = new Date()): boolean {
  const d = r.record.deadlineAt;
  if (r.record.kind === "historical_award" || !d) return false;
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59Z` : d).getTime();
  return !Number.isNaN(t) && t < now.getTime();
}

/** Most recent prior award that names a winner, for the "Prior winner" line. */
export function latestPriorWinner(r: RankedResult): { recipient: string; date: string | null; count: number } | null {
  const awards = (r.priorAwards ?? []).filter((a) => a.recipient && a.recipient.trim());
  if (!awards.length) return null;
  const sorted = [...awards].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { recipient: sorted[0].recipient as string, date: sorted[0].date, count: r.priorAwards?.length ?? 0 };
}

/** Points this record could earn (docs/interface.md): scores are never rescaled to 100. */
export const fitMaxOf = (r: RankedResult) => (r.fitMax && r.fitMax > 0 ? r.fitMax : 100);

/** Results below the shortlist carry this deterministic gate finding: the critic never saw them. */
export const isUnreviewed = (r: RankedResult) => r.findings.some((f) => f.issue.startsWith("Outside the shortlist"));

/**
 * A past award at 95% or more of its available points, so only the very best results earn it. An exact maximum needs a perfect score on every signal,
 * which no real record has reached. Must read as a strong historical match, never "perfect" or an open opportunity.
 */
export const isStrongHistorical = (r: RankedResult) => isHistorical(r) && Math.round(r.fitScore) * 20 >= fitMaxOf(r) * 19;

export function fitLabel(r: RankedResult): string {
  if (!isHistorical(r)) return "Fit score";
  return isStrongHistorical(r) ? "Strong historical match" : "Hist. relevance";
}

/**
 * Display-only: SAM.gov sometimes returns titles with long runs of U+FFFD (undecodable bytes, as received).
 * Show a plain marker instead of a wall of replacement characters. The record itself stays verbatim.
 */
export const displayTitle = (title: string) => title.replace(/�{2,}/g, " [unreadable characters] ").replace(/\s{2,}/g, " ").trim();
