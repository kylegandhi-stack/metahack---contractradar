import type { AuditSeverity, RankedResult, ReviewStatus, SourceKind } from "@/lib/types";
import { cn, ELIGIBILITY_LABEL, KIND_LABEL, STATUS_LABEL } from "./format";

const base =
  "inline-flex items-center gap-1.5 border px-2 py-[3px] font-mono text-[10.5px] uppercase leading-none tracking-[0.12em] whitespace-nowrap";

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0", className)} />;
}

export function SourceKindBadge({ kind, className }: { kind: SourceKind; className?: string }) {
  const style = {
    open_notice: ["border-clear/50 text-clear", "bg-clear"],
    early_stage_notice: ["border-sky-300/40 text-sky-200", "bg-sky-300"],
    historical_award: ["border-line-strong text-muted", "bg-muted"],
  }[kind];
  return (
    <span className={cn(base, style[0], className)}>
      <Dot className={style[1]} />
      {KIND_LABEL[kind]}
    </span>
  );
}

export function ReviewStatusBadge({ status, className, short }: { status: ReviewStatus; className?: string; short?: boolean }) {
  const style = {
    APPROVED: ["border-clear/50 text-clear", "bg-clear"],
    REVIEW_REQUIRED: ["border-warn/60 text-warn", "bg-warn"],
    HOLD: ["border-hold/70 bg-hold/10 text-hold", "bg-hold blink"],
  }[status];
  const text = short ? { APPROVED: "Approved", REVIEW_REQUIRED: "Review required", HOLD: "Hold" }[status] : STATUS_LABEL[status];
  return (
    <span className={cn(base, style[0], className)}>
      <Dot className={style[1]} />
      {text}
    </span>
  );
}

export function EligibilityBadge({ value }: { value: RankedResult["eligibility"] }) {
  const style = {
    meets_known_requirements: "text-clear",
    needs_verification: "text-warn",
    known_blocker: "text-hold",
  }[value];
  return (
    <span className="inline-flex items-center gap-2">
      <span className="label">Eligibility</span>
      <span className={cn("font-mono text-[11px] uppercase tracking-[0.1em]", style)}>{ELIGIBILITY_LABEL[value]}</span>
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  const style = {
    BLOCKER: ["border-hold/70 bg-hold/10 text-hold", "bg-hold"],
    WARNING: ["border-warn/60 text-warn", "bg-warn"],
    NOTE: ["border-line-strong text-muted", "bg-muted"],
  }[severity];
  return (
    <span className={cn(base, style[0])}>
      <Dot className={style[1]} />
      {severity}
    </span>
  );
}

export function ConfidencePill({ value }: { value: RankedResult["confidence"] }) {
  const bars = { low: 1, medium: 2, high: 3 }[value];
  return (
    <span className="inline-flex items-center gap-2">
      <span className="label">Confidence</span>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn("w-[3px]", i <= bars ? "bg-foreground" : "bg-line-strong")} style={{ height: 4 + i * 3 }} />
        ))}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.1em]">{value}</span>
    </span>
  );
}

export function ExpiredBadge({ className }: { className?: string }) {
  return (
    <span className={cn(base, "border-hold/70 bg-hold text-background", className)}>
      Expired
    </span>
  );
}
