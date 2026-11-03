import { AlertOctagon, AlertTriangle, CheckCircle2, History, Info, Megaphone, PauseCircle, Radar } from "lucide-react";
import type { AuditSeverity, RankedResult, ReviewStatus, SourceKind } from "@/lib/types";
import { cn, ELIGIBILITY_LABEL, KIND_LABEL, STATUS_LABEL } from "./format";

const base = "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function SourceKindBadge({ kind, className }: { kind: SourceKind; className?: string }) {
  const style = {
    open_notice: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    early_stage_notice: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    historical_award: "border-slate-500/50 bg-slate-500/10 text-slate-300",
  }[kind];
  const Icon = { open_notice: Megaphone, early_stage_notice: Radar, historical_award: History }[kind];
  return (
    <span className={cn(base, style, className)}>
      <Icon className="size-3.5" aria-hidden />
      {KIND_LABEL[kind]}
    </span>
  );
}

export function ReviewStatusBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  const style = {
    APPROVED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    REVIEW_REQUIRED: "border-amber-500/50 bg-amber-500/10 text-amber-300",
    HOLD: "border-red-500/60 bg-red-500/15 text-red-300",
  }[status];
  const Icon = { APPROVED: CheckCircle2, REVIEW_REQUIRED: AlertTriangle, HOLD: PauseCircle }[status];
  return (
    <span className={cn(base, style, className)}>
      <Icon className="size-3.5" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function EligibilityBadge({ value }: { value: RankedResult["eligibility"] }) {
  const style = {
    meets_known_requirements: "border-emerald-500/30 text-emerald-300",
    needs_verification: "border-amber-500/40 text-amber-300",
    known_blocker: "border-red-500/50 text-red-300",
  }[value];
  return <span className={cn(base, "bg-transparent", style)}>{ELIGIBILITY_LABEL[value]}</span>;
}

export function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  const style = {
    BLOCKER: "border-red-500/60 bg-red-500/15 text-red-300",
    WARNING: "border-amber-500/50 bg-amber-500/10 text-amber-300",
    NOTE: "border-slate-500/50 bg-slate-500/10 text-slate-300",
  }[severity];
  const Icon = { BLOCKER: AlertOctagon, WARNING: AlertTriangle, NOTE: Info }[severity];
  return (
    <span className={cn(base, style)}>
      <Icon className="size-3.5" aria-hidden />
      {severity}
    </span>
  );
}

export function ConfidencePill({ value }: { value: RankedResult["confidence"] }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      Confidence: <span className="font-medium text-foreground capitalize">{value}</span>
    </span>
  );
}
