import { ArrowUpRight } from "lucide-react";
import type { RankedResult } from "@/lib/types";
import { ConfidencePill, EligibilityBadge, ReviewStatusBadge, SourceKindBadge } from "./badges";
import { cn, fmtDate, fmtMoney, isHistorical, orUnknown, sourceName } from "./format";

export function FitScore({ result, size = "md" }: { result: RankedResult; size?: "md" | "lg" }) {
  const label = isHistorical(result) ? "Hist. relevance" : "Fit score";
  const score = Math.max(0, Math.min(100, Math.round(result.fitScore)));
  const bar = { HOLD: "bg-hold", REVIEW_REQUIRED: "bg-warn", APPROVED: "bg-foreground" }[result.reviewStatus];
  return (
    <div className={cn("shrink-0 text-right", size === "lg" ? "w-28" : "w-24")}>
      <p className={cn("font-light leading-none tabular-nums tracking-tight", size === "lg" ? "text-5xl" : "text-4xl")}>
        {score}
        <span className="ml-0.5 font-mono text-xs text-dim">/100</span>
      </p>
      <div className="mt-2 h-[2px] w-full bg-line-strong" aria-hidden>
        <div className={cn("h-full", bar)} style={{ width: `${score}%` }} />
      </div>
      <p className="label mt-1.5">{label}</p>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="label">{k}</dt>
      <dd className="mt-1 truncate font-mono text-[12.5px]">{v}</dd>
    </div>
  );
}

export function OpportunityCard({ result, rank, onOpen }: { result: RankedResult; rank: number; onOpen: () => void }) {
  const { record } = result;
  const hist = isHistorical(result);
  const blockers = result.findings.filter((f) => f.severity === "BLOCKER").length;
  const warnings = result.findings.filter((f) => f.severity === "WARNING").length;
  const hold = result.reviewStatus === "HOLD";

  return (
    <article className={cn("group relative border bg-panel/80 transition hover:bg-panel-2", hold ? "border-hold/50" : "border-line hover:border-line-strong")}>
      {hold && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-hold" />}
      <div className="flex gap-4 p-4 sm:gap-6 sm:p-5">
        <span className="hidden font-mono text-3xl font-light leading-none text-dim sm:block" aria-hidden>
          {String(rank).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-dim sm:hidden">#{String(rank).padStart(2, "0")}</span>
                <SourceKindBadge kind={record.kind} />
                <ReviewStatusBadge status={result.reviewStatus} short />
              </div>
              <h3 className="mt-3 text-base font-normal leading-snug tracking-tight sm:text-lg">
                <button onClick={onOpen} className="text-left decoration-line-strong underline-offset-4 hover:underline">{record.title}</button>
              </h3>
              <p className="label mt-1.5 normal-case tracking-[0.06em]">{orUnknown(record.agency)}</p>
            </div>
            <FitScore result={result} />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
            {hist ? (
              <>
                <Stat k="Award amount" v={fmtMoney(record.awardAmount)} />
                <Stat k="Award date" v={fmtDate(record.postedAt)} />
              </>
            ) : (
              <>
                <Stat k="Response due" v={fmtDate(record.deadlineAt)} />
                <Stat k="Posted" v={fmtDate(record.postedAt)} />
              </>
            )}
            <Stat k="Set-aside" v={orUnknown(record.setAside)} />
            <Stat k="Retrieved" v={fmtDate(record.retrievedAt)} />
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            {!hist && <EligibilityBadge value={result.eligibility} />}
            <ConfidencePill value={result.confidence} />
            {(blockers > 0 || warnings > 0) && (
              <span className="font-mono text-[11px] uppercase tracking-[0.1em]">
                {blockers > 0 && <span className="text-hold">{blockers} blocker{blockers > 1 ? "s" : ""}</span>}
                {blockers > 0 && warnings > 0 && <span className="text-dim"> / </span>}
                {warnings > 0 && <span className="text-warn">{warnings} warning{warnings > 1 ? "s" : ""}</span>}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-stretch justify-between border-t border-line">
        <a
          href={record.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted transition hover:text-foreground sm:px-5"
        >
          Source: {sourceName(record.source)} <ArrowUpRight className="size-3.5" aria-hidden />
          <span className="sr-only">(opens in new tab)</span>
        </a>
        <button
          onClick={onOpen}
          className="border-l border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] transition hover:bg-foreground hover:text-background sm:px-5"
        >
          Inspect evidence →
        </button>
      </div>
    </article>
  );
}
