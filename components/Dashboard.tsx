"use client";

import { useMemo, useState } from "react";
import type { CompanyProfile, RankedResult, ResearchResponse, SourceKind } from "@/lib/types";
import sample from "@/data/sample-research-response.json";
import { AgentActivity } from "./AgentActivity";
import { FindingsPanel } from "./FindingsPanel";
import { HeroBackdrop, HeroCredit } from "./HeroBackdrop";
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

function RadarMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.25">
      <circle cx="12" cy="12" r="10" opacity="0.5" />
      <circle cx="12" cy="12" r="6" opacity="0.7" />
      <path d="M12 12 L19 5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TopBar({ sampleMode, dataMode }: { sampleMode: boolean; dataMode?: "live" | "cached" }) {
  const item = "hidden items-center gap-2 border-l border-line px-4 md:flex";
  return (
    <div className="sticky top-0 z-30 border-b border-line bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-[1400px] items-stretch justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <RadarMark />
          <span className="font-mono text-[13px] uppercase tracking-[0.22em]"><span className="font-semibold">Rauros</span> <span className="text-muted">Systems</span></span>
        </div>
        <div className="flex items-stretch">
          <span className={item}><span className="label">Sys</span><span className="size-1.5 bg-clear blink" aria-hidden /><span className="font-mono text-[11px] uppercase tracking-[0.12em]">Online</span></span>
          <span className={item}><span className="label">Model</span><span className="font-mono text-[11px] uppercase tracking-[0.12em]">Muse Spark 1.3</span></span>
          <span className={item}><span className="label">Agents</span><span className="font-mono text-[11px] tracking-[0.12em]">05</span></span>
          {dataMode && <span className={item}><span className="label">Data</span><span className={cn("font-mono text-[11px] uppercase tracking-[0.12em]", dataMode === "cached" ? "text-warn" : "text-clear")}>{dataMode}</span></span>}
          {sampleMode && (
            <span className="flex items-center gap-2 border-l border-line pl-4">
              <span className="border border-signal/60 px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.12em] text-signal">Sample mode</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "hold" | "warn" | "neutral" | "signal"; title: string; children: React.ReactNode }) {
  const t = {
    hold: ["border-hold/50 bg-hold/[0.06]", "bg-hold", "text-hold"],
    warn: ["border-warn/50 bg-warn/[0.06]", "bg-warn", "text-warn"],
    neutral: ["border-line-strong bg-panel-2", "bg-muted", "text-foreground"],
    signal: ["border-signal/40 bg-signal/[0.05]", "bg-signal", "text-signal"],
  }[tone];
  return (
    <div role="note" className={cn("relative border py-3 pl-5 pr-4 text-sm", t[0])}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[2px]", t[1])} />
      <p className={cn("font-mono text-[11px] uppercase tracking-[0.14em]", t[2])}>{title}</p>
      <p className="mt-1 text-foreground/80">{children}</p>
    </div>
  );
}

const SOURCE_NAME = { sam: "SAM.gov notices", usaspending: "USAspending awards" } as const;

/** Names which sources are saved copies (docs/interface.md): absent cachedSources means all are saved. */
function CachedBanner({ data }: { data: ResearchResponse }) {
  const all = ["sam", "usaspending"] as const;
  const saved = data.cachedSources ?? [...all];
  // Only call a source live if this run actually shows records from it (#34): an unconfigured source isn't "live".
  const live = all.filter((s) => !saved.includes(s) && data.results.some((r) => r.record.source === s));
  const oldest = data.results.filter((r) => saved.includes(r.record.source)).map((r) => r.record.retrievedAt).sort()[0];
  const names = saved.map((s) => SOURCE_NAME[s]).join(" and ");
  return (
    <Notice tone="warn" title={`Cached ${names} — retrieved ${fmtDateTime(oldest ?? data.runAt)}`}>
      The live {saved.length > 1 ? "searches" : "search"} failed or {saved.length > 1 ? "aren't" : "isn't"} configured, so saved copies of real public records are shown.
      {live.length > 0 && ` ${live.map((s) => SOURCE_NAME[s]).join(" and ")} are live.`}
    </Notice>
  );
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
  const holds = data?.results.filter((r) => r.reviewStatus === "HOLD").length ?? 0;

  return (
    <>
      <TopBar sampleMode={sampleMode} dataMode={data?.dataMode} />
      {/* Hero: full-bleed imagery behind a max-width content grid */}
      <div className="relative isolate border-b border-line">
        <HeroBackdrop />
        <section className="mx-auto grid max-w-[1400px] gap-10 px-4 pb-8 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14">
          <div className="flex flex-col justify-between gap-8">
            <div>
              <p className="label"><span className="text-signal">{"//"}</span> Federal procurement intelligence</p>
              <h1 className="mt-5 text-[2.6rem] font-light leading-[1.02] tracking-[-0.035em] sm:text-6xl xl:text-7xl">
                Find the contracts worth bidding.
                <span className="block text-muted">Kill the ones that aren&apos;t.</span>
              </h1>
              <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted">
                An AI business-development team for small defense suppliers. Five agents search public federal records,
                qualify each lead against your capabilities, and a red-team critic argues against every shortlisted recommendation
                before you spend a week on a proposal.
              </p>
            </div>
            <ol className="grid grid-cols-5 border border-line">
              {["Plan", "Scout", "Qualify", "Strategize", "Red team"].map((s, i) => (
                <li key={s} className={cn("px-2 py-3 sm:px-3", i > 0 && "border-l border-line")}>
                  <p className="font-mono text-[10.5px] text-dim">0{i + 1}</p>
                  <p className={cn("mt-1 font-mono text-[10px] uppercase tracking-[0.1em] sm:text-[11px]", i === 4 ? "text-hold" : "text-foreground")}>{s}</p>
                </li>
              ))}
            </ol>
          </div>
          <ProfileForm onSubmit={run} loading={state.phase === "loading"} />
          <div className="lg:col-span-2"><HeroCredit /></div>
        </section>
      </div>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 sm:px-6">

        {state.phase === "loading" && (
          <section role="status" className="hud relative mt-8 overflow-hidden p-6">
            <span aria-hidden className="scanbar absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-signal/10 to-transparent" />
            <p className="label text-foreground"><span className="text-signal">●</span> Agents running</p>
            <p className="mt-2 text-sm text-muted">Querying public federal records and running five agents. This usually takes under a minute. The pipeline log appears when the run completes.</p>
          </section>
        )}

        {state.phase === "error" && (
          <section role="alert" className="relative mt-8 flex flex-wrap items-start justify-between gap-4 border border-hold/60 bg-hold/[0.06] py-4 pl-5 pr-4">
            <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-hold" />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-hold">Run failed</p>
              <p className="mt-1 text-sm text-foreground/85">{state.message}</p>
            </div>
            {lastProfile && (
              <button onClick={() => run(lastProfile)} className="border border-line-strong px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition hover:bg-foreground hover:text-background">
                Retry
              </button>
            )}
          </section>
        )}

        {data && state.phase === "done" && (
          <>
            <div className="mt-8 space-y-2">
              {state.isSample && <Notice tone="signal" title="Demo / sample data">These records are a development fixture, not live government data.</Notice>}
              {data.dataMode === "cached" && (
                <CachedBanner data={data} />
              )}
              {historicalOnly && (
                <Notice tone="neutral" title="Historical buyers and procurement intelligence">Every result below is a past award. None is an open solicitation.</Notice>
              )}
              {data.warnings.filter((w) => !(state.isSample && w.toUpperCase().startsWith("SAMPLE"))).map((w, i) => (
                <Notice key={i} tone="warn" title="Warning">{w}</Notice>
              ))}
            </div>

            {/* Run summary strip */}
            <dl className="mt-8 grid grid-cols-2 border border-line sm:grid-cols-4">
              {[
                ["Records reviewed", String(data.recordsUsed).padStart(2, "0")],
                ["Ranked targets", String(data.results.length).padStart(2, "0")],
                ["Held by red team", String(holds).padStart(2, "0")],
                ["Run time", fmtDateTime(data.runAt)],
              ].map(([k, v], i) => (
                <div key={k} className={cn("px-4 py-4", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line sm:border-t-0", i === 2 && "sm:border-l")}>
                  <dt className="label">{k}</dt>
                  <dd className={cn("mt-2 tabular-nums", i < 3 ? "text-3xl font-light tracking-tight" : "font-mono text-[12.5px]", i === 2 && holds > 0 && "text-hold")}>{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-8 grid gap-6 pb-16 lg:grid-cols-[minmax(0,1fr)_380px]">
              <section aria-labelledby="results-heading">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <h2 id="results-heading" className="label text-foreground"><span className="text-dim">[02]</span> Ranked targets</h2>
                  <div role="tablist" aria-label="Filter by record type" className="flex flex-wrap border border-line">
                    {(["all", "open_notice", "early_stage_notice", "historical_award"] as Filter[]).map((f, i) => (
                      <button
                        key={f}
                        role="tab"
                        aria-selected={filter === f}
                        onClick={() => setFilter(f)}
                        disabled={f !== "all" && counts[f] === 0}
                        className={cn(
                          "px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-30",
                          i > 0 && "border-l border-line",
                          filter === f ? "bg-foreground text-background" : "text-muted hover:text-foreground",
                        )}
                      >
                        {f === "all" ? "All" : KIND_LABEL[f]} <span className="opacity-60">{counts[f]}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {visible.length === 0 ? (
                  <div className="hud p-6 text-sm text-muted">No matching records were found for this profile. Try broader capability wording or remove target agencies.</div>
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
      </main>

      <OpportunityDetail result={open} onClose={() => setOpen(null)} />

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <p className="label">Sources: USAspending.gov · SAM.gov</p>
          <p className="text-xs text-dim">Public federal records. Fictional company profiles only. Not legal, compliance or eligibility advice.</p>
        </div>
      </footer>
    </>
  );
}
