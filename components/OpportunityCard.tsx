import { ArrowUpRight } from "lucide-react";
import type { RankedResult } from "@/lib/types";
import { ConfidencePill, EligibilityBadge, ExpiredBadge, ReviewStatusBadge, SourceKindBadge } from "./badges";
import { cn, fitLabel, fitMaxOf, fmtDate, fmtMoney, isExpired, isHistorical, KIND_LABEL, latestPriorWinner, orUnknown, sourceName } from "./format";

export function FitScore({ result, size = "md" }: { result: RankedResult; size?: "md" | "lg" }) {
  const max = fitMaxOf(result);
  const score = Math.max(0, Math.min(max, Math.round(result.fitScore)));
  const bar = { HOLD: "bg-hold", REVIEW_REQUIRED: "bg-warn", APPROVED: "bg-foreground" }[result.reviewStatus];
  const hist = isHistorical(result);
  return (
    <div
      className={cn("shrink-0 text-right", size === "lg" ? "w-36" : "w-32")}
      title={hist ? `Past awards can earn at most ${max} points: eligibility and timing don't apply.` : `Relevance points out of ${max}, not a win probability.`}
    >
      <p className={cn("font-light leading-none tabular-nums tracking-tight", size === "lg" ? "text-5xl" : "text-4xl")}>
        {score}
        <span className="ml-0.5 font-mono text-xs text-dim">/{max}</span>
      </p>
      <div className="mt-2 h-[2px] w-full bg-line-strong" aria-hidden>
        <div className={cn("h-full", hist ? "bg-muted" : bar)} style={{ width: `${(score / max) * 100}%` }} />
      </div>
      <p className="label mt-1.5">{fitLabel(result)}</p>
      {hist && <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">of {max} available</p>}
    </div>
  );
}

function Stat({ k, v, className }: { k: string; v: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="label">{k}</dt>
      <dd className={cn("mt-1 truncate font-mono text-[12.5px]", className)}>{v}</dd>
    </div>
  );
}

export function OpportunityCard({ result, rank, onOpen }: { result: RankedResult; rank: number; onOpen: () => void }) {
  const { record } = result;
  const hist = isHistorical(result);
  const blockers = result.findings.filter((f) => f.severity === "BLOCKER").length;
  const warnings = result.findings.filter((f) => f.severity === "WARNING").length;
  const hold = result.reviewStatus === "HOLD";
  const expired = isExpired(result);
  const prior = latestPriorWinner(result);

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
                {expired && <ExpiredBadge />}
                <ReviewStatusBadge status={result.reviewStatus} kind={record.kind} short />
              </div>
              <h3 className="mt-3 text-base font-normal leading-snug tracking-tight sm:text-lg">
                <button onClick={onOpen} className="text-left decoration-line-strong underline-offset-4 hover:underline">{record.title}</button>
              </h3>
              <p className="label mt-1.5 normal-case tracking-[0.06em]">{orUnknown(record.agency)}</p>
              {hist && record.recipient && (
                <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">Awarded to <span className="text-foreground">{record.recipient}</span></p>
              )}
              {!hist && prior && (
                <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                  Prior winner <span className="text-foreground">{prior.recipient}</span>
                  {prior.date && <span className="text-dim"> · {fmtDate(prior.date)}</span>}
                  {prior.count > 1 && <span className="text-dim"> · {prior.count} past awards from this buyer</span>}
                </p>
              )}
              {!!record.relatedNotices?.length && (
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-dim">
                  Also posted as {record.relatedNotices.map((n) => `${KIND_LABEL[n.kind]}${n.postedAt ? ` · ${fmtDate(n.postedAt)}` : ""}`).join(" / ")}
                </p>
              )}
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
                <Stat k={expired ? "Deadline passed" : "Response due"} v={fmtDate(record.deadlineAt)} className={expired ? "text-hold line-through decoration-hold/60" : undefined} />
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
