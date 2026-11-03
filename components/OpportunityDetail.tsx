"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, X } from "lucide-react";
import type { FitBreakdown, RankedResult } from "@/lib/types";
import { ConfidencePill, EligibilityBadge, ExpiredBadge, ReviewStatusBadge, SourceKindBadge } from "./badges";
import { FindingItem, sortFindings } from "./FindingsPanel";
import { FitScore } from "./OpportunityCard";
import { cn, fitMaxOf, fmtDate, fmtDateTime, fmtMoney, isExpired, isHistorical, isStrongHistorical, KIND_LABEL, orUnknown, sourceName } from "./format";

function Section({ n, title, children, tone }: { n: string; title: string; children: React.ReactNode; tone?: string }) {
  return (
    <section className="border-t border-line px-5 py-5 sm:px-7">
      <h3 className={cn("label mb-3", tone)}><span className="text-dim">{n}</span> {title}</h3>
      {children}
    </section>
  );
}

function Bullets({ items, empty, marker = "—" }: { items: string[]; empty: string; marker?: string }) {
  if (!items.length) return <p className="text-sm text-dim">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-sm leading-relaxed">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3"><span className="font-mono text-dim" aria-hidden>{marker}</span><span>{t}</span></li>
      ))}
    </ul>
  );
}

const BREAKDOWN: { key: keyof FitBreakdown; label: string; max: number; notForAwards?: boolean }[] = [
  { key: "technical", label: "Technical fit", max: 40 },
  { key: "category", label: "Product, buyer & recency", max: 20 },
  { key: "eligibility", label: "Known eligibility", max: 20, notForAwards: true },
  { key: "execution", label: "Execution scope", max: 10 },
  { key: "timing", label: "Timing", max: 10, notForAwards: true },
];

function FitBreakdownTable({ r }: { r: RankedResult }) {
  const b = r.fitBreakdown!;
  const historical = isHistorical(r);
  const max = fitMaxOf(r);
  const score = Math.max(0, Math.min(max, Math.round(r.fitScore)));
  return (
    <Section n={"//"} title={historical ? "Historical relevance breakdown" : "Fit breakdown"}>
      <p className="mb-4 text-sm">
        <span className="font-mono tabular-nums">{score}</span>
        <span className="text-dim"> of {max} available points</span>
        {isStrongHistorical(r) && <span className="text-muted"> · strong historical match</span>}
      </p>
      <ul className="space-y-3">
        {BREAKDOWN.map(({ key, label, max: m, notForAwards }) => {
          const na = historical && notForAwards;
          const v = b[key];
          const pct = na || v === null ? 0 : Math.max(0, Math.min(100, (v / m) * 100));
          return (
            <li key={key} className={cn("grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-3", na && "opacity-50")}>
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{label}</span>
              <span className="relative h-[6px] bg-line" aria-hidden>
                <span className="absolute inset-y-0 left-0 bg-foreground" style={{ width: `${pct}%` }} />
                {Array.from({ length: m / 2 - 1 }).map((_, i) => (
                  <span key={i} className="absolute inset-y-0 w-px bg-background" style={{ left: `${((i + 1) * 2 * 100) / m}%` }} />
                ))}
              </span>
              <span className="text-right font-mono text-xs tabular-nums">
                {na ? <span className="text-dim">N/A</span> : v === null ? <span className="text-dim">UNKNOWN</span> : <>{v}<span className="text-dim">/{m}</span></>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-dim">
        {historical
          ? `Past awards can't earn eligibility or timing points, so they're scored out of ${max}. This is relevance, not an open opportunity or a probability of winning.`
          : "Relevance points, not a probability of winning."}
      </p>
      {!!r.fitSignals?.length && (
        <div className="mt-5">
          <p className="label mb-2">Scoring signals</p>
          <ul className="divide-y divide-line border-y border-line">
            {r.fitSignals.map((s, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                <span className="min-w-0">{s.detail}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums">{s.points}<span className="text-dim">/{s.max}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-dim">Points before the weak-match limit, so they can add up to more than the bar above. Award-size points are estimates.</p>
        </div>
      )}
    </Section>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="label py-2">{k}</dt>
      <dd className="py-2 font-mono text-[12.5px] break-all">{children}</dd>
    </>
  );
}

export function OpportunityDetail({ result, onClose }: { result: RankedResult | null; onClose: () => void }) {
  const r = result;
  return (
    <Dialog.Root open={!!r} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto border-l border-line-strong bg-background focus:outline-none">
          {r && (
            <>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-background/95 px-5 py-3 backdrop-blur sm:px-7">
                <span className="label">Target dossier · <span className="text-foreground">{r.record.id}</span></span>
                <Dialog.Close className="p-1 text-muted transition hover:text-foreground" aria-label="Close details">
                  <X className="size-5" />
                </Dialog.Close>
              </div>

              <div className="px-5 py-6 sm:px-7">
                <div className="flex flex-wrap gap-2">
                  <SourceKindBadge kind={r.record.kind} />
                  {isExpired(r) && <ExpiredBadge />}
                  <ReviewStatusBadge status={r.reviewStatus} kind={r.record.kind} />
                </div>
                <div className="mt-5 flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <Dialog.Title className="text-2xl font-light leading-tight tracking-tight sm:text-3xl">{r.record.title}</Dialog.Title>
                    <Dialog.Description className="label mt-2 normal-case tracking-[0.06em]">{orUnknown(r.record.agency)}</Dialog.Description>
                  </div>
                  <FitScore result={r} size="lg" />
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                  {!isHistorical(r) && <EligibilityBadge value={r.eligibility} />}
                  <ConfidencePill value={r.confidence} />
                </div>

                {isExpired(r) && (
                  <div role="alert" className="relative mt-5 border border-hold/60 bg-hold/10 py-3 pl-4 pr-3 text-sm">
                    <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-hold" />
                    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-hold">Expired — response deadline passed {fmtDate(r.record.deadlineAt)}</p>
                    <p className="mt-1 text-foreground/85">This notice can no longer be answered as posted. It may still help you identify the buyer and a possible re-solicitation.</p>
                  </div>
                )}
                {r.reviewStatus === "HOLD" && !isExpired(r) && (
                  <div role="alert" className="relative mt-5 border border-hold/60 bg-hold/10 py-3 pl-4 pr-3 text-sm">
                    <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-hold" />
                    <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-hold">Hold — do not pursue as presented</p>
                    <p className="mt-1 text-foreground/85">The Devil&apos;s Advocate found a verified contradiction in the source record. See the red-team findings below.</p>
                  </div>
                )}
                {isHistorical(r) && (
                  <div className="mt-5 border border-line-strong bg-panel-2 px-4 py-3 text-sm">
                    <p className="label text-foreground">Past award — not an open opportunity</p>
                    <p className="mt-1 text-muted">Use it to identify buyers and incumbents. There is nothing to bid on here.</p>
                  </div>
                )}
              </div>

              {r.fitBreakdown && <FitBreakdownTable r={r} />}

              <Section n="A" title="Why it fits" tone="text-clear">
                <Bullets items={r.whyMatched} empty="No fit reasons provided." marker="+" />
              </Section>

              <Section n="B" title="Limitations" tone="text-warn">
                <Bullets items={r.blockers} empty="No limitations listed by the analyst." marker="!" />
              </Section>

              <Section n="C" title="Red team findings" tone="text-hold">
                {r.findings.length ? (
                  <ul className="space-y-2">{sortFindings(r.findings).map((f, i) => <FindingItem key={i} f={f} />)}</ul>
                ) : (
                  <p className="text-sm text-dim">No findings returned for this record.</p>
                )}
              </Section>

              <Section n="D" title="Evidence · verbatim from source">
                {r.record.excerpts.length ? (
                  <ul className="space-y-2">
                    {r.record.excerpts.map((e, i) => (
                      <li key={i} className="border border-line bg-panel px-4 py-3">
                        <p className="label text-dim">field: {e.field}</p>
                        <p className="mt-1.5 font-mono text-[12.5px] leading-relaxed">“{e.text}”</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-dim">No source excerpts returned.</p>
                )}
              </Section>

              <Section n="E" title="Source record">
                <dl className="grid grid-cols-[9rem_1fr] divide-y divide-line border-y border-line [&>*]:border-line">
                  <Row k="Source">{sourceName(r.record.source)}</Row>
                  <Row k="Record ID">{r.record.id}</Row>
                  {r.record.solicitationNumber && <Row k="Solicitation no.">{r.record.solicitationNumber}</Row>}
                  {isHistorical(r) && <Row k="Awarded to">{orUnknown(r.record.recipient)}</Row>}
                  <Row k={isHistorical(r) ? "Award date" : "Posted"}>{fmtDate(r.record.postedAt)}</Row>
                  {!isHistorical(r) && <Row k="Response due">{isExpired(r) ? <span className="text-hold">{fmtDate(r.record.deadlineAt)} · expired</span> : fmtDate(r.record.deadlineAt)}</Row>}
                  {isHistorical(r) && <Row k="Award amount">{fmtMoney(r.record.awardAmount)} <span className="text-dim">(past obligation, not available budget)</span></Row>}
                  <Row k="Set-aside">{orUnknown(r.record.setAside)}</Row>
                  <Row k="NAICS">{orUnknown(r.record.naics)}</Row>
                  <Row k="Retrieved">{fmtDateTime(r.record.retrievedAt)}</Row>
                </dl>
                <a
                  href={r.record.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 border border-line-strong px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition hover:bg-foreground hover:text-background"
                >
                  Open original on {sourceName(r.record.source)} <ArrowUpRight className="size-3.5" aria-hidden />
                </a>
              </Section>

              {!!r.record.relatedNotices?.length && (
                <Section n="E1" title="Other postings of this buy">
                  <ul className="divide-y divide-line border-y border-line">
                    {r.record.relatedNotices.map((n) => (
                      <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="font-mono text-[12px]">
                          <span className="uppercase tracking-[0.1em] text-muted">{KIND_LABEL[n.kind]}</span>
                          <span className="text-dim"> · posted {fmtDate(n.postedAt)} · {n.id}</span>
                        </span>
                        <a href={n.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted hover:text-foreground">
                          Open <ArrowUpRight className="size-3.5" aria-hidden />
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-dim">Merged into this target because SAM.gov lists them as the same buy.</p>
                </Section>
              )}

              {!isHistorical(r) && r.priorAwards && (
                <Section n="F" title="Buyer history · past awards from this buyer">
                  {r.priorAwards.length === 0 ? (
                    <p className="text-sm text-dim">No past awards from this buyer were found in USAspending.</p>
                  ) : (
                    <ul className="space-y-2">
                      {[...r.priorAwards].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).map((a) => (
                        <li key={a.id} className="border border-line bg-panel px-4 py-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <p className="font-mono text-[11px] uppercase tracking-[0.1em]">
                              <span className="text-muted">Winner</span> <span className="text-foreground">{orUnknown(a.recipient)}</span>
                            </p>
                            <p className="font-mono text-[11px] text-dim">{fmtDate(a.date)} · {fmtMoney(a.amount)}</p>
                          </div>
                          <p className="mt-1.5 text-sm leading-snug">{a.title}</p>
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted hover:text-foreground">
                            USAspending.gov <ArrowUpRight className="size-3" aria-hidden />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-dim">Past obligations from public records, not available budget. The incumbent is whoever won before; it is not a prediction.</p>
                </Section>
              )}

              <Section n="G" title="Next actions" tone="text-foreground">
                <Bullets items={r.nextSteps} empty="No next actions provided." marker="→" />
              </Section>

              <p className="border-t border-line px-5 py-4 text-xs text-dim sm:px-7">
                Recommendations only. Not an eligibility determination, legal opinion or win probability.
              </p>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
