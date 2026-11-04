import type { AuditFinding, RankedResult } from "@/lib/types";
import { ReviewStatusBadge, SeverityBadge } from "./badges";
import { isUnreviewed, displayTitle } from "./format";

const ORDER = { BLOCKER: 0, WARNING: 1, NOTE: 2 } as const;
export const sortFindings = (f: AuditFinding[]) => [...f].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

export function FindingItem({ f }: { f: AuditFinding }) {
  const bar = { BLOCKER: "bg-hold", WARNING: "bg-warn", NOTE: "bg-dim" }[f.severity];
  return (
    <li className="relative border border-line bg-panel-2 py-3 pl-4 pr-3">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[2px] ${bar}`} />
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={f.severity} />
        <p className="text-sm">{f.issue}</p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted"><span className="label mr-1.5">Impact</span>{f.whyItMatters}</p>
      {f.evidenceExcerpt ? (
        <blockquote className="mt-2 border-l border-line-strong pl-3 font-mono text-[11.5px] leading-relaxed text-foreground/85">
          “{f.evidenceExcerpt}”
          {f.evidenceSourceId && <span className="text-dim"> — {f.evidenceSourceId}</span>}
        </blockquote>
      ) : (
        <p className="mt-2 font-mono text-[11px] text-dim">{f.evidenceSourceId ? `SRC ${f.evidenceSourceId} · no excerpt` : "No evidence cited — needs verification"}</p>
      )}
      <p className="mt-2 text-xs leading-relaxed"><span className="label mr-1.5">Correction</span>{f.correctiveAction}</p>
    </li>
  );
}

/** Devil's Advocate summary across the shortlist. */
export function FindingsPanel({ results, onOpen }: { results: RankedResult[]; onOpen: (r: RankedResult) => void }) {
  // Only results the critic actually reviewed count here; the rest are summarized in one line below.
  const unreviewed = results.filter(isUnreviewed).length;
  const reviewed = results.filter((r) => !isUnreviewed(r));
  const counts = { BLOCKER: 0, WARNING: 0, NOTE: 0 };
  reviewed.forEach((r) => r.findings.forEach((f) => counts[f.severity]++));
  const RANK = { HOLD: 0, REVIEW_REQUIRED: 1, APPROVED: 2 } as const;
  const flaggedAll = reviewed
    .filter((r) => r.findings.some((f) => f.severity !== "NOTE") || r.reviewStatus !== "APPROVED")
    .sort((a, b) => RANK[a.reviewStatus] - RANK[b.reviewStatus]);
  const MAX = 5;
  const flagged = flaggedAll.slice(0, MAX);
  const more = flaggedAll.length - flagged.length;

  return (
    <section aria-labelledby="da-heading" className="hud border-hold/30 p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="da-heading" className="label text-foreground"><span className="text-dim">[03]</span> Red team — Devil&apos;s Advocate</h2>
      </div>
      <p className="mt-1 text-xs text-dim">An independent critic tried to disprove every shortlisted recommendation.</p>

      <dl className="mt-4 grid grid-cols-3 border border-line">
        {([["Blockers", counts.BLOCKER, "text-hold"], ["Warnings", counts.WARNING, "text-warn"], ["Notes", counts.NOTE, "text-muted"]] as const).map(([k, v, c], i) => (
          <div key={k} className={`px-3 py-2.5 ${i > 0 ? "border-l border-line" : ""}`}>
            <dt className="label">{k}</dt>
            <dd className={`mt-1 font-mono text-2xl font-light tabular-nums ${v > 0 ? c : "text-dim"}`}>{String(v).padStart(2, "0")}</dd>
          </div>
        ))}
      </dl>

      {flaggedAll.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No blockers or warnings found after checking.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {flagged.map((r) => {
            const top = sortFindings(r.findings)[0];
            return (
              <li key={r.record.id}>
                <button onClick={() => onOpen(r)} className="w-full border border-line bg-panel-2 p-3 text-left transition hover:border-line-strong">
                  <ReviewStatusBadge status={r.reviewStatus} kind={r.record.kind} short />
                  <p className="mt-2 line-clamp-2 text-sm">{displayTitle(r.record.title)}</p>
                  {top && <p className="mt-1 text-xs text-muted"><span className="font-mono text-[10.5px] tracking-[0.1em]">{top.severity} ·</span> {top.issue}</p>}
                </button>
              </li>
            );
          })}
          {more > 0 && <li className="label pt-1 text-dim">+{more} more flagged. Open any target to see its findings.</li>}
          {unreviewed > 0 && <li className="label pt-1 text-dim">{unreviewed} result{unreviewed === 1 ? "" : "s"} below the shortlist {unreviewed === 1 ? "was" : "were"} not reviewed.</li>}
        </ul>
      )}
    </section>
  );
}
