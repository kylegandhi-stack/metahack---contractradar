import { ShieldAlert } from "lucide-react";
import type { AuditFinding, RankedResult } from "@/lib/types";
import { ReviewStatusBadge, SeverityBadge } from "./badges";

const ORDER = { BLOCKER: 0, WARNING: 1, NOTE: 2 } as const;
const sortFindings = (f: AuditFinding[]) => [...f].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

export function FindingItem({ f }: { f: AuditFinding }) {
  const border = { BLOCKER: "border-l-red-500", WARNING: "border-l-amber-500", NOTE: "border-l-slate-500" }[f.severity];
  return (
    <li className={`rounded-md border border-line border-l-4 ${border} bg-panel-2 p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={f.severity} />
        <p className="text-sm font-medium">{f.issue}</p>
      </div>
      <p className="mt-1.5 text-xs text-muted"><span className="font-medium text-slate-300">Why it matters:</span> {f.whyItMatters}</p>
      {f.evidenceExcerpt ? (
        <blockquote className="mt-2 border-l-2 border-slate-600 pl-2 text-xs italic text-slate-300">
          “{f.evidenceExcerpt}”
          {f.evidenceSourceId && <span className="not-italic text-muted"> — {f.evidenceSourceId}</span>}
        </blockquote>
      ) : (
        <p className="mt-2 text-xs text-muted">{f.evidenceSourceId ? `Source: ${f.evidenceSourceId} (no excerpt)` : "Missing evidence — needs verification"}</p>
      )}
      <p className="mt-1.5 text-xs"><span className="font-medium text-slate-300">Correction:</span> {f.correctiveAction}</p>
    </li>
  );
}

/** Devil's Advocate summary across the shortlist. */
export function FindingsPanel({ results, onOpen }: { results: RankedResult[]; onOpen: (r: RankedResult) => void }) {
  const counts = { BLOCKER: 0, WARNING: 0, NOTE: 0 };
  results.forEach((r) => r.findings.forEach((f) => counts[f.severity]++));
  const flagged = results.filter((r) => r.findings.some((f) => f.severity !== "NOTE") || r.reviewStatus !== "APPROVED");

  return (
    <section aria-labelledby="da-heading" className="rounded-xl border border-red-500/30 bg-panel p-5">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-5 text-red-300" aria-hidden />
        <h2 id="da-heading" className="text-base font-semibold">Devil&apos;s Advocate review</h2>
      </div>
      <p className="mt-0.5 text-xs text-muted">An independent critic tried to disprove each recommendation.</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-red-500/15 px-2 py-1 text-red-300">{counts.BLOCKER} blocker{counts.BLOCKER === 1 ? "" : "s"}</span>
        <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">{counts.WARNING} warning{counts.WARNING === 1 ? "" : "s"}</span>
        <span className="rounded bg-slate-500/10 px-2 py-1 text-slate-300">{counts.NOTE} note{counts.NOTE === 1 ? "" : "s"}</span>
      </div>
      {flagged.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No blockers or warnings found after checking.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {flagged.map((r) => {
            const top = sortFindings(r.findings)[0];
            return (
              <li key={r.record.id}>
                <button onClick={() => onOpen(r)} className="w-full rounded-md border border-line bg-panel-2 p-3 text-left hover:border-slate-500">
                  <div className="flex flex-wrap items-center gap-2"><ReviewStatusBadge status={r.reviewStatus} /></div>
                  <p className="mt-1.5 line-clamp-2 text-sm font-medium">{r.record.title}</p>
                  {top && <p className="mt-1 text-xs text-muted"><span className="font-semibold">{top.severity}:</span> {top.issue}</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export { sortFindings };
