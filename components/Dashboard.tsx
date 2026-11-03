"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Database, FlaskConical, Radar, RotateCcw } from "lucide-react";
import type { CompanyProfile, RankedResult, ResearchResponse, SourceKind } from "@/lib/types";
import sample from "@/data/sample-research-response.json";
import { AgentActivity } from "./AgentActivity";
import { FindingsPanel } from "./FindingsPanel";
import { OpportunityCard } from "./OpportunityCard";
import { OpportunityDetail } from "./OpportunityDetail";
import { ProfileForm } from "./ProfileForm";
import { cn, fmtDateTime, KIND_LABEL } from "./format";

const TIMEOUT_MS = 150_000;
type Filter = "all" | SourceKind;
type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "done"; data: ResearchResponse; isSample: boolean };

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const msg = typeof body?.error === "string" ? body.error : body?.error?.message ?? body?.message;
    if (msg) return msg;
  } catch { /* not JSON */ }
  if (res.status === 429) return "Too many requests right now. Wait a moment and try again.";
  if (res.status === 404) return "The research service isn't available yet.";
  return `The research service returned an error (HTTP ${res.status}).`;
}

export function Dashboard({ sampleMode }: { sampleMode: boolean }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<RankedResult | null>(null);
  const [lastProfile, setLastProfile] = useState<CompanyProfile | null>(null);

  const run = async (profile: CompanyProfile) => {
    setLastProfile(profile);
    setFilter("all");
    if (sampleMode) {
      setState({ phase: "done", data: sample as unknown as ResearchResponse, isSample: true });
      return;
    }
    setState({ phase: "loading" });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as ResearchResponse;
      if (!Array.isArray(data?.results)) throw new Error("The research service returned an unexpected response.");
      setState({ phase: "done", data, isSample: false });
    } catch (e) {
      const message =
        e instanceof DOMException && e.name === "AbortError"
          ? `The research run took longer than ${TIMEOUT_MS / 1000} seconds and was stopped.`
          : e instanceof Error ? e.message : "Something went wrong.";
      setState({ phase: "error", message });
    } finally {
      clearTimeout(timer);
    }
  };

  const data = state.phase === "done" ? state.data : null;
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, open_notice: 0, early_stage_notice: 0, historical_award: 0 };
    data?.results.forEach((r) => { c.all++; c[r.record.kind]++; });
    return c;
  }, [data]);
  const visible = data?.results.filter((r) => filter === "all" || r.record.kind === filter) ?? [];
  const historicalOnly = !!data && data.results.length > 0 && counts.historical_award === counts.all;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Radar className="size-6 text-sky-400" aria-hidden />
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">ContractRadar</h1>
          </div>
          <p className="mt-1 text-sm text-muted">
            An AI business-development team for small defense suppliers: finds federal procurement leads, qualifies them, and argues against bad bids.
          </p>
        </div>
        {sampleMode && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-fuchsia-500/50 bg-fuchsia-500/10 px-2.5 py-1 text-xs font-semibold text-fuchsia-200">
            <FlaskConical className="size-3.5" aria-hidden /> Sample data mode
          </span>
        )}
      </header>

      <ProfileForm onSubmit={run} loading={state.phase === "loading"} />

      {state.phase === "loading" && (
        <div role="status" className="mt-6 rounded-xl border border-line bg-panel p-6 text-sm">
          <p className="font-medium">Running five agents against public federal records…</p>
          <p className="mt-1 text-muted">This usually takes under a minute. The agent log appears when the run completes.</p>
        </div>
      )}

      {state.phase === "error" && (
        <div role="alert" className="mt-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-red-500/50 bg-red-500/10 p-4">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-300" aria-hidden />
            <div>
              <p className="text-sm font-medium text-red-200">Research run failed</p>
              <p className="mt-0.5 text-sm text-red-200/80">{state.message}</p>
            </div>
          </div>
          {lastProfile && (
            <button onClick={() => run(lastProfile)} className="inline-flex items-center gap-1.5 rounded-md border border-red-400/50 px-3 py-1.5 text-sm hover:bg-red-500/10">
              <RotateCcw className="size-4" aria-hidden /> Retry
            </button>
          )}
        </div>
      )}

      {data && state.phase === "done" && (
        <>
          {state.isSample && (
            <div role="note" className="mt-6 rounded-xl border border-fuchsia-500/50 bg-fuchsia-500/10 p-3 text-sm text-fuchsia-100">
              <strong>Demo/sample data.</strong> These records are a development fixture, not live government data.
            </div>
          )}
          {data.dataMode === "cached" && (
            <div role="note" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">
              <Database className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p><strong>Cached public records</strong> — retrieved {fmtDateTime(data.results.map((r) => r.record.retrievedAt).sort()[0] ?? data.runAt)}. Live sources were not queried for this run.</p>
            </div>
          )}
          {historicalOnly && (
            <div role="note" className="mt-3 rounded-xl border border-slate-500/50 bg-slate-500/10 p-3 text-sm text-slate-200">
              <strong>Historical buyers and procurement intelligence.</strong> Every result below is a past award. None is an open solicitation.
            </div>
          )}
          {data.warnings.filter((w) => !(state.isSample && w.startsWith("SAMPLE"))).map((w, i) => (
            <p key={i} className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">{w}</p>
          ))}

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section aria-labelledby="results-heading">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 id="results-heading" className="text-base font-semibold">
                  Ranked results <span className="text-sm font-normal text-muted">· {data.recordsUsed} records reviewed · run {fmtDateTime(data.runAt)}</span>
                </h2>
              </div>
              <div role="tablist" aria-label="Filter by record type" className="mb-4 flex flex-wrap gap-2">
                {(["all", "open_notice", "early_stage_notice", "historical_award"] as Filter[]).map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    disabled={f !== "all" && counts[f] === 0}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-40",
                      filter === f ? "border-sky-400 bg-sky-400/15 text-sky-200" : "border-line text-muted hover:text-foreground",
                    )}
                  >
                    {f === "all" ? "All" : KIND_LABEL[f]} ({counts[f]})
                  </button>
                ))}
              </div>
              {visible.length === 0 ? (
                <div className="rounded-xl border border-line bg-panel p-6 text-sm text-muted">
                  No matching records were found for this profile. Try broader capability wording or remove target agencies.
                </div>
              ) : (
                <div className="space-y-3">
                  {visible.map((r) => (
                    <OpportunityCard key={`${r.record.source}:${r.record.id}`} result={r} rank={data.results.indexOf(r) + 1} onOpen={() => setOpen(r)} />
                  ))}
                </div>
              )}
            </section>
            <aside className="space-y-6">
              <FindingsPanel results={data.results} onOpen={setOpen} />
              <AgentActivity events={data.agentEvents} />
            </aside>
          </div>
        </>
      )}

      <OpportunityDetail result={open} onClose={() => setOpen(null)} />

      <footer className="mt-10 border-t border-line pt-4 text-xs text-muted">
        Public federal records from USAspending.gov{" "}and SAM.gov. Fictional company profiles only. Not legal, compliance or eligibility advice.
      </footer>
    </div>
  );
}
