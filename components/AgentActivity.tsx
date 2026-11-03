import { CheckCircle2, Circle, XCircle } from "lucide-react";
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

  return (
    <section aria-labelledby="agents-heading" className="rounded-xl border border-line bg-panel p-5">
      <h2 id="agents-heading" className="text-base font-semibold">Agent activity</h2>
      <p className="mt-0.5 text-xs text-muted">Logged by the backend during this run.</p>
      <ol className="mt-4 space-y-3">
        {STEP_ORDER.map((step, i) => {
          const entry = byStep.get(step);
          const status = entry?.end?.status ?? (entry?.started ? "started" : undefined);
          const detail = entry?.end?.detail ?? entry?.started?.detail;
          const ms = entry?.started && entry?.end ? new Date(entry.end.timestamp).getTime() - new Date(entry.started.timestamp).getTime() : null;
          const Icon = status === "completed" ? CheckCircle2 : status === "failed" ? XCircle : Circle;
          return (
            <li key={step} className="flex gap-3">
              <Icon
                className={cn("mt-0.5 size-5 shrink-0", status === "completed" && "text-emerald-400", status === "failed" && "text-red-400", !status && "text-slate-600", status === "started" && "text-amber-400")}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  <span className="text-muted">{i + 1}.</span> {STEP_LABEL[step]}
                  {step === "devils_advocate" && <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">Critic</span>}
                  {ms !== null && ms >= 0 && <span className="ml-2 text-xs font-normal text-muted">{(ms / 1000).toFixed(1)}s</span>}
                </p>
                <p className="text-xs text-muted break-words">
                  {status ? detail : "No event recorded"}
                  {status === "failed" && <span className="text-red-300"> — failed</span>}
                  {status === "started" && <span className="text-amber-300"> — did not report completion</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
