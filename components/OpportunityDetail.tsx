"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, X } from "lucide-react";
import type { FitBreakdown, RankedResult } from "@/lib/types";
import { ConfidencePill, EligibilityBadge, ReviewStatusBadge, SourceKindBadge } from "./badges";
import { FindingItem, sortFindings } from "./FindingsPanel";
import { FitScore } from "./OpportunityCard";
import { fmtDate, fmtDateTime, fmtMoney, isHistorical, orUnknown, sourceName } from "./format";

function Section({ title, children, tone }: { title: string; children: React.ReactNode; tone?: string }) {
  return (
    <section className="mt-5">
      <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wider ${tone ?? "text-muted"}`}>{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((t, i) => <li key={i}>{t}</li>)}
    </ul>
  );
}

const BREAKDOWN: { key: keyof FitBreakdown; label: string; max: number }[] = [
  { key: "technical", label: "Technical fit", max: 40 },
  { key: "category", label: "Category alignment", max: 20 },
  { key: "eligibility", label: "Known eligibility", max: 20 },
  { key: "execution", label: "Execution scope", max: 10 },
  { key: "timing", label: "Timing", max: 10 },
];

function FitBreakdownTable({ b, historical }: { b: FitBreakdown; historical: boolean }) {
  return (
    <Section title={historical ? "Historical relevance breakdown" : "Fit breakdown"}>
      <ul className="space-y-2">
        {BREAKDOWN.map(({ key, label, max }) => {
          const v = b[key];
          const pct = v === null ? 0 : Math.max(0, Math.min(100, (v / max) * 100));
          return (
            <li key={key} className="grid grid-cols-[9rem_1fr_4.5rem] items-center gap-3 text-sm">
              <span className="text-muted">{label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                <span className="block h-full rounded-full bg-sky-400" style={{ width: `${pct}%` }} />
              </span>
              <span className="text-right tabular-nums">{v === null ? <span className="text-muted">Unknown</span> : <>{v}<span className="text-muted">/{max}</span></>}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">A relevance score, not a probability of winning.</p>
    </Section>
  );
}

export function OpportunityDetail({ result, onClose }: { result: RankedResult | null; onClose: () => void }) {
  const r = result;
  return (
    <Dialog.Root open={!!r} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-line bg-background p-5 shadow-2xl focus:outline-none sm:p-6">
          {r && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <SourceKindBadge kind={r.record.kind} />
                  <ReviewStatusBadge status={r.reviewStatus} />
                </div>
                <Dialog.Close className="rounded-md p-1 text-muted hover:bg-panel hover:text-foreground" aria-label="Close details">
                  <X className="size-5" />
                </Dialog.Close>
              </div>
              <div className="mt-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Dialog.Title className="text-lg font-semibold leading-snug">{r.record.title}</Dialog.Title>
                  <Dialog.Description className="mt-1 text-sm text-muted">{orUnknown(r.record.agency)}</Dialog.Description>
                </div>
                <FitScore result={r} size="lg" />
              </div>

              {r.reviewStatus === "HOLD" && (
                <div role="alert" className="mt-4 rounded-md border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-200">
                  <strong>Hold — do not pursue as presented.</strong> The Devil&apos;s Advocate found a verified problem. See the review below.
                </div>
              )}
              {isHistorical(r) && (
                <div className="mt-4 rounded-md border border-slate-500/50 bg-slate-500/10 p-3 text-sm text-slate-200">
                  This is a <strong>past award</strong>, not an open opportunity. Use it to identify buyers and incumbents. There is nothing to bid on here.
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {!isHistorical(r) && <EligibilityBadge value={r.eligibility} />}
                <ConfidencePill value={r.confidence} />
              </div>

              {r.fitBreakdown && <FitBreakdownTable b={r.fitBreakdown} historical={isHistorical(r)} />}

              <Section title="Why it fits" tone="text-emerald-300">
                <Bullets items={r.whyMatched} empty="No fit reasons provided." />
              </Section>

              <Section title="Limitations" tone="text-amber-300">
                <Bullets items={r.blockers} empty="No limitations listed by the analyst." />
              </Section>

              <Section title="Devil's Advocate review" tone="text-red-300">
                {r.findings.length ? (
                  <ul className="space-y-2">{sortFindings(r.findings).map((f, i) => <FindingItem key={i} f={f} />)}</ul>
                ) : (
                  <p className="text-sm text-muted">No findings returned for this record.</p>
                )}
              </Section>

              <Section title="Evidence (verbatim from source)">
                {r.record.excerpts.length ? (
                  <ul className="space-y-2">
                    {r.record.excerpts.map((e, i) => (
                      <li key={i} className="rounded-md border border-line bg-panel p-3">
                        <p className="font-mono text-[11px] uppercase text-muted">{e.field}</p>
                        <p className="mt-1 text-sm">“{e.text}”</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No source excerpts returned.</p>
                )}
              </Section>

              <Section title="Source record">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted">Source</dt><dd>{sourceName(r.record.source)}</dd>
                  <dt className="text-muted">Record ID</dt><dd className="font-mono text-xs break-all">{r.record.id}</dd>
                  <dt className="text-muted">{isHistorical(r) ? "Award date" : "Posted"}</dt><dd>{fmtDate(r.record.postedAt)}</dd>
                  {!isHistorical(r) && (<><dt className="text-muted">Response deadline</dt><dd>{fmtDate(r.record.deadlineAt)}</dd></>)}
                  {isHistorical(r) && (<><dt className="text-muted">Award amount</dt><dd>{fmtMoney(r.record.awardAmount)} <span className="text-xs text-muted">(past obligation, not available budget)</span></dd></>)}
                  <dt className="text-muted">Set-aside</dt><dd>{orUnknown(r.record.setAside)}</dd>
                  <dt className="text-muted">NAICS</dt><dd>{orUnknown(r.record.naics)}</dd>
                  <dt className="text-muted">Retrieved</dt><dd>{fmtDateTime(r.record.retrievedAt)}</dd>
                </dl>
                <a href={r.record.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-sky-300 hover:underline">
                  Open original record on {sourceName(r.record.source)} <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </Section>

              <Section title="Next actions" tone="text-sky-300">
                <Bullets items={r.nextSteps} empty="No next actions provided." />
              </Section>

              <p className="mt-6 border-t border-line pt-3 text-xs text-muted">
                Recommendations only, not an eligibility determination, legal opinion or win probability.
              </p>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
