import { ExternalLink } from "lucide-react";
import type { RankedResult } from "@/lib/types";
import { ConfidencePill, EligibilityBadge, ReviewStatusBadge, SourceKindBadge } from "./badges";
import { cn, fmtDate, fmtMoney, isHistorical, orUnknown, sourceName } from "./format";

export function FitScore({ result, size = "md" }: { result: RankedResult; size?: "md" | "lg" }) {
  const label = isHistorical(result) ? "Historical relevance" : "Fit";
  const score = Math.max(0, Math.min(100, Math.round(result.fitScore)));
  return (
    <div className="text-right">
      <p className={cn("font-semibold tabular-nums", size === "lg" ? "text-3xl" : "text-2xl")}>
        {score}<span className="text-sm font-normal text-muted">/100</span>
      </p>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

export function OpportunityCard({ result, rank, onOpen }: { result: RankedResult; rank: number; onOpen: () => void }) {
  const { record } = result;
  const hist = isHistorical(result);
  const accent = { HOLD: "border-red-500/60", REVIEW_REQUIRED: "border-amber-500/40", APPROVED: "border-line" }[result.reviewStatus];
  const blockers = result.findings.filter((f) => f.severity === "BLOCKER").length;
  const warnings = result.findings.filter((f) => f.severity === "WARNING").length;

  return (
    <article className={cn("rounded-xl border bg-panel p-4 transition hover:bg-panel-2", accent, result.reviewStatus === "HOLD" && "bg-red-950/20")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted">#{rank}</span>
            <SourceKindBadge kind={record.kind} />
            <ReviewStatusBadge status={result.reviewStatus} />
          </div>
          <h3 className="mt-2 text-sm font-semibold leading-snug md:text-base">
            <button onClick={onOpen} className="text-left hover:underline">{record.title}</button>
          </h3>
          <p className="mt-0.5 text-xs text-muted">{orUnknown(record.agency)}</p>
        </div>
        <FitScore result={result} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        {hist ? (
          <>
            <div><dt className="text-muted">Award amount</dt><dd>{fmtMoney(record.awardAmount)}</dd></div>
            <div><dt className="text-muted">Award date</dt><dd>{fmtDate(record.postedAt)}</dd></div>
          </>
        ) : (
          <>
            <div><dt className="text-muted">Response deadline</dt><dd>{fmtDate(record.deadlineAt)}</dd></div>
            <div><dt className="text-muted">Posted</dt><dd>{fmtDate(record.postedAt)}</dd></div>
          </>
        )}
        <div><dt className="text-muted">Set-aside</dt><dd className="truncate">{orUnknown(record.setAside)}</dd></div>
        <div><dt className="text-muted">Retrieved</dt><dd>{fmtDate(record.retrievedAt)}</dd></div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {!hist && <EligibilityBadge value={result.eligibility} />}
        <ConfidencePill value={result.confidence} />
        {(blockers > 0 || warnings > 0) && (
          <span className="text-xs">
            {blockers > 0 && <span className="text-red-300">{blockers} blocker{blockers > 1 ? "s" : ""}</span>}
            {blockers > 0 && warnings > 0 && <span className="text-muted"> · </span>}
            {warnings > 0 && <span className="text-amber-300">{warnings} warning{warnings > 1 ? "s" : ""}</span>}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <a href={record.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline">
          View on {sourceName(record.source)} <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">(opens in new tab)</span>
        </a>
        <button onClick={onOpen} className="rounded-md border border-line px-3 py-1 text-xs font-medium hover:border-slate-500">
          Details &amp; evidence
        </button>
      </div>
    </article>
  );
}
