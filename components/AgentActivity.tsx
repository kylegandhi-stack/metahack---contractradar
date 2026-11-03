import type { AgentEvent } from "@/lib/types";
import { cn, STEP_LABEL, STEP_ORDER } from "./format";

/** Shows only genuine AgentEvent data returned by the backend; never simulates progress. */
export function AgentActivity({ events }: { events: AgentEvent[] }) {
  const byStep = new Map<AgentEvent["step"], { started?: AgentEvent; end?: AgentEvent }>();
  for (const ev of events) {
    const entry = byStep.get(ev.step) ?? {};
    if (ev.status === "started") entry.started = ev;
    else entry.end = ev;
    byStep.set(ev.step, entry);
  }
  const total = (() => {
    const ts = events.map((e) => new Date(e.timestamp).getTime()).filter((n) => !Number.isNaN(n));
    return ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 1000 : null;
  })();

  return (
    <section aria-labelledby="agents-heading" className="hud p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="agents-heading" className="label text-foreground"><span className="text-dim">[04]</span> Agent pipeline</h2>
        {total !== null && <span className="font-mono text-[11px] text-muted">T+{total.toFixed(1)}s</span>}
      </div>
      <p className="mt-1 text-xs text-dim">Execution log returned by the backend for this run.</p>
      <ol className="relative mt-5">
        {STEP_ORDER.map((step, i) => {
          const entry = byStep.get(step);
          const status = entry?.end?.status ?? (entry?.started ? "started" : undefined);
          const detail = entry?.end?.detail ?? entry?.started?.detail;
          const ms = entry?.started && entry?.end ? new Date(entry.end.timestamp).getTime() - new Date(entry.started.timestamp).getTime() : null;
          const tone =
            status === "completed" ? "border-clear bg-clear" : status === "failed" ? "border-hold bg-hold" : status === "started" ? "border-warn" : "border-dim";
          const last = i === STEP_ORDER.length - 1;
          return (
            <li key={step} className="relative flex gap-4 pb-5 last:pb-0">
              {!last && <span aria-hidden className="absolute left-[4.5px] top-3 h-full w-px bg-line-strong" />}
              <span aria-hidden className={cn("relative mt-1 size-2.5 shrink-0 border", tone)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em]">
                    <span className="text-dim">0{i + 1}</span>{" "}
                    <span className={step === "devils_advocate" ? "text-hold" : "text-foreground"}>{STEP_LABEL[step]}</span>
                  </p>
                  {ms !== null && ms >= 0 && <span className="font-mono text-[10.5px] text-dim">{(ms / 1000).toFixed(1)}s</span>}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted break-words">
                  {status ? detail : "No event recorded"}
                  {status === "failed" && <span className="text-hold"> — failed</span>}
                  {status === "started" && <span className="text-warn"> — did not report completion</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
