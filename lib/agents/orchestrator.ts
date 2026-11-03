// The five logical agents run in order inside one server-side function. Every AgentEvent wraps a
// real call. Dependencies are injectable so the tests can drive the gates without the network.
import { loadVerifiedRecords, type CachedRecords } from "../data/cache";
import { collapseNotices, describeNotices, isSamConfigured, withSamUsage, type SamUsage } from "../data/sam";
import { dedupeRecords, enrichWithAwardDetail, UsaSpendingError } from "../data/usaspending";
import { MetaError, RunBudget } from "../meta";
import {
  applyGates,
  capCriticWarnings,
  dedupeFindings,
  sortFindings,
  statusFromFindings,
  verifyCriticFinding,
} from "../review";
import { ResearchResponseSchema } from "../schemas";
import { computeFit, finalConfidence } from "../scoring";
import type {
  AgentEvent,
  AgentStep,
  AuditFinding,
  CompanyProfile,
  PriorAward,
  RankedResult,
  ResearchResponse,
  SourceRecord,
} from "../types";
import { loadSamSnapshot, type ProfileSnapshot } from "../data/snapshot";
import { verifyRecords } from "../data/verify";
import { findBuyerHistory } from "../data/buyer-history";
import { runAnalyst, type Assessment } from "./analyst";
import { runDevilsAdvocate, type CriticVerdict } from "./devils-advocate";
import { runPlanner, type ResearchPlan } from "./planner";
import { MAX_CANDIDATES, runScout, type ScoutResult } from "./scout";
import { reviseShortlist, runStrategist, SHORTLIST_SIZE, type Pick } from "./strategist";

export const RUN_CAP_MS = 105_000;
const MAX_ANALYSES = 12;
const MAX_RESULTS = 10;
const REVISION_CUTOFF_MS = 50_000;
const BID_LANGUAGE = /\b(apply|bid|submit|respond|response|proposal|quote)\b/i;
const HISTORICAL_DEFAULT_STEP =
  "Use this past award for buyer discovery: check this agency for current notices.";

export type PipelineDeps = {
  plan: typeof runPlanner;
  scout: typeof runScout;
  analyze: typeof runAnalyst;
  strategize: typeof runStrategist;
  revise: typeof reviseShortlist;
  critique: typeof runDevilsAdvocate;
  enrich: typeof enrichWithAwardDetail;
  describe: typeof describeNotices;
  loadSnapshot: typeof loadSamSnapshot;
  verify: typeof verifyRecords;
  history: typeof findBuyerHistory;
  descriptionsEnabled: () => boolean;
  loadCache: () => CachedRecords | null;
  samConfigured: () => boolean;
  now: () => number;
};

const defaultDeps: PipelineDeps = {
  plan: runPlanner,
  scout: runScout,
  analyze: runAnalyst,
  strategize: runStrategist,
  revise: reviseShortlist,
  critique: runDevilsAdvocate,
  enrich: enrichWithAwardDetail,
  describe: describeNotices,
  loadSnapshot: loadSamSnapshot,
  verify: verifyRecords,
  history: findBuyerHistory,
  // Up to 5 extra SAM.gov calls per run, against a small daily quota, so this is opt-in.
  descriptionsEnabled: () => process.env.SAM_DESCRIPTIONS === "on",
  loadCache: loadVerifiedRecords,
  samConfigured: isSamConfigured,
  now: Date.now,
};

export class NoUsableDataError extends Error {}

const MIN_ANALYSES = 5;
const MAX_SAME_ITEM = 2;

// Long repeat orders use the same title, sometimes behind a DLA number such as "8509698046!".
const itemKey = (record: SourceRecord) =>
  record.title.replace(/^\d+!/, "").replace(/\s+/g, " ").trim().toUpperCase();

// Deterministic: same input and same records give the same analysis set between runs. Source searches
// also match fields a person can't see, and return the largest awards first, so a record must show a
// search term in its own text. The Planner lists its most specific terms first, so those count more.
export function selectForAnalysis(records: SourceRecord[], terms: string[]): SourceRecord[] {
  // A singular stem also finds the plural, and the Planner may choose either form.
  const lowered = terms.map((term) =>
    term.toLowerCase().replace(/ies$/, "y").replace(/y$/, "").replace(/([^s])s$/, "$1"),
  );
  const score = (record: SourceRecord) => {
    const text = `${record.title} ${record.description ?? ""}`.toLowerCase();
    return lowered.reduce((total, term, index) => {
      if (text.includes(term)) return total + 3 + (lowered.length - index);
      const words = term.split(/\s+/).filter((word) => word.length >= 4);
      return total + (words.some((word) => text.includes(word)) ? 1 : 0);
    }, 0);
  };
  const ranked = records
    .map((record, index) => {
      const match = score(record);
      return { record, index, match, value: match + (record.kind === "historical_award" ? 0 : 2) };
    })
    .sort((a, b) => b.value - a.value || a.index - b.index);

  const seen = new Map<string, number>();
  const picked = ranked.filter(({ record, match }) => {
    if (match === 0) return false;
    const key = itemKey(record);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count < MAX_SAME_ITEM;
  });
  // Too few visible matches: fill up, so a thinly described field still gets results to review.
  const fill = picked.length < MIN_ANALYSES ? ranked.filter((entry) => !picked.includes(entry)) : [];
  return [...picked, ...fill.slice(0, MIN_ANALYSES - picked.length)].slice(0, MAX_ANALYSES).map((entry) => entry.record);
}

function cleanNextSteps(record: SourceRecord, steps: string[]): string[] {
  if (record.kind !== "historical_award") return steps;
  const safe = steps.filter((step) => !BID_LANGUAGE.test(step));
  return safe.length > 0 ? safe : [HISTORICAL_DEFAULT_STEP];
}

function criticFindings(record: SourceRecord, verdict: CriticVerdict | undefined): AuditFinding[] {
  if (!verdict) {
    return [
      {
        severity: "WARNING",
        issue: "Devil's Advocate returned no verdict for this record",
        whyItMatters: "This recommendation has not been independently challenged.",
        evidenceSourceId: null,
        evidenceExcerpt: null,
        correctiveAction: "Needs verification against the source record.",
      },
    ];
  }
  const findings = verdict.findings.map((finding) => verifyCriticFinding(finding, record));
  if (findings.length === 0 && verdict.noneFound) {
    findings.push({
      severity: "NOTE",
      issue: "Devil's Advocate found no weakness after checking",
      whyItMatters: verdict.verdict,
      evidenceSourceId: record.id,
      evidenceExcerpt: null,
      correctiveAction: "Still confirm details on the source record before acting.",
    });
  }
  return findings;
}

export function buildResult(args: {
  record: SourceRecord;
  profile: CompanyProfile;
  assessment: Assessment | undefined;
  pick: Pick | undefined;
  extraFindings: AuditFinding[];
  critic?: AuditFinding[];
  priorAwards?: PriorAward[];
  now: number;
}): RankedResult {
  const { record, profile, assessment, pick, extraFindings, critic = [], priorAwards, now } = args;
  const { fitBreakdown, fitScore } = computeFit(assessment ?? {}, record.kind);
  const gate = applyGates(record, profile, fitBreakdown.technical, now);
  const uncertainties: AuditFinding[] = (assessment?.uncertainties ?? []).slice(0, 3).map((issue) => ({
    severity: "NOTE",
    issue,
    whyItMatters: "The analyst could not confirm this from the source record.",
    evidenceSourceId: null,
    evidenceExcerpt: null,
    correctiveAction: "Check the source record.",
  }));
  const findings = sortFindings(
    capCriticWarnings(
      dedupeFindings([...gate.findings, ...extraFindings, ...critic, ...uncertainties]),
      new Set(critic),
    ),
  );
  const reviewStatus = statusFromFindings(findings);
  return {
    record,
    fitScore,
    fitBreakdown,
    confidence: finalConfidence(assessment?.confidence ?? "low", reviewStatus),
    eligibility: gate.eligibility,
    whyMatched: [...(pick ? [pick.rationale] : []), ...(assessment?.whyMatched ?? [])],
    blockers: findings.filter((finding) => finding.severity === "BLOCKER").map((finding) => finding.issue),
    nextSteps: cleanNextSteps(record, pick?.nextSteps ?? ["Open the source record and verify scope."]),
    findings,
    reviewStatus,
    ...(priorAwards?.length ? { priorAwards } : {}),
  };
}

// Only a spent quota or a missing key falls back. Other SAM.gov errors keep their existing warning.
function loadSnapshotIfSamUnavailable(profile: CompanyProfile, scout: ScoutResult, deps: PipelineDeps) {
  return !deps.samConfigured() || scout.samThrottled ? deps.loadSnapshot(profile.name) : null;
}

function descriptionNote(record: SourceRecord, issue: string, whyItMatters: string): AuditFinding {
  return {
    severity: "NOTE",
    issue,
    whyItMatters,
    evidenceSourceId: record.id,
    evidenceExcerpt: null,
    correctiveAction: "Read the full notice on the source record.",
  };
}

// Adds source text to shortlisted SAM notices when SAM_DESCRIPTIONS is "on". A failed or skipped fetch
// leaves the description null and adds a NOTE: it never blocks a run. Also skipped when SAM.gov already
// failed, to avoid spending more quota.
async function addNoticeDescriptions(
  records: SourceRecord[],
  shortlist: Pick[],
  deps: PipelineDeps,
  samFailure: string | null,
  saved: ProfileSnapshot | null,
) {
  const ids = new Set(shortlist.map((pick) => pick.sourceId));
  const targets = records.filter((record) => record.source === "sam" && ids.has(record.id));
  const notes = new Map<string, AuditFinding[]>();
  if (targets.length === 0) return { records, notes, count: 0 };
  const fetched =
    samFailure || !deps.samConfigured() || !deps.descriptionsEnabled()
      ? { texts: new Map<string, string>(), unavailable: targets.map((record) => record.id), shortened: [] as string[] }
      : await deps.describe(targets);
  // Saved text fills in only what could not be fetched live.
  const texts = new Map(fetched.texts);
  const shortened = [...fetched.shortened];
  const unavailable: string[] = [];
  for (const id of fetched.unavailable) {
    const text = saved?.descriptions[id];
    if (!text) {
      unavailable.push(id);
      continue;
    }
    texts.set(id, text);
    if (saved?.shortened.includes(id)) shortened.push(id);
  }
  for (const record of targets) {
    if (unavailable.includes(record.id)) {
      notes.set(record.id, [
        descriptionNote(
          record,
          "SAM.gov description was not retrieved",
          "This review used the notice's title and summary fields only, so requirements in its full text were not checked.",
        ),
      ]);
    } else if (shortened.includes(record.id)) {
      notes.set(record.id, [
        descriptionNote(
          record,
          "SAM.gov description was shortened for review",
          "Requirements later in the notice's full text were not checked.",
        ),
      ]);
    }
  }
  return {
    notes,
    count: texts.size,
    records: records.map((record) => {
      const text = texts.get(record.id);
      if (!text) return record;
      return { ...record, description: text, excerpts: [...record.excerpts, { field: "description", text }] };
    }),
  };
}

// Wraps a run so usage is logged for failed runs too, which are the ones most worth seeing.
export async function runResearch(
  profile: CompanyProfile,
  options: { signal?: AbortSignal; deps?: Partial<PipelineDeps> } = {},
): Promise<ResearchResponse> {
  const deps = { ...defaultDeps, ...options.deps };
  const startedAt = deps.now();
  const budget = new RunBudget(options.signal ?? AbortSignal.timeout(RUN_CAP_MS));
  const sam: SamUsage = { requests: 0, throttled: false };
  let outcome = "failed";
  try {
    const response = await withSamUsage(sam, () => executeRun(profile, deps, budget, startedAt));
    outcome = "completed";
    return response;
  } finally {
    console.info("research run", JSON.stringify({ outcome, ms: deps.now() - startedAt, sam, ...budget.summary() }));
  }
}

async function executeRun(
  profile: CompanyProfile,
  deps: PipelineDeps,
  budget: RunBudget,
  startedAt: number,
): Promise<ResearchResponse> {
  const agentEvents: AgentEvent[] = [];
  const warnings: string[] = [];

  async function stage<T>(step: AgentStep, start: string, work: () => Promise<T>, done: (value: T) => string) {
    agentEvents.push({ step, status: "started", timestamp: new Date().toISOString(), detail: start });
    try {
      const value = await work();
      agentEvents.push({ step, status: "completed", timestamp: new Date().toISOString(), detail: done(value) });
      return value;
    } catch (error) {
      const detail = error instanceof MetaError ? error.message : "Stage failed";
      agentEvents.push({ step, status: "failed", timestamp: new Date().toISOString(), detail });
      throw error;
    }
  }

  const plan: ResearchPlan = await stage(
    "planner",
    "Extracting capabilities and search terms",
    () => deps.plan(profile, budget),
    (value) =>
      `Search terms: ${value.searchTerms.join(", ")}. Provisional categories: ${
        value.categories.map((category) => `${category.scheme} ${category.code}`).join(", ") || "none"
      }`,
  );

  const scout: ScoutResult = await stage(
    "scout",
    "Searching federal sources with model-directed tool calls",
    () => deps.scout(plan, budget),
    (value) =>
      `${value.modelDirected ? `${value.turns} tool round(s)` : "Model made no tool call; server searched planner terms"}: ${
        value.toolCalls.join("; ") || "no calls"
      }. ${value.records.length} unique records.`,
  );

  const cachedSources = new Set<"sam" | "usaspending">();
  let candidates = scout.records;
  if (candidates.length === 0 && !scout.usaspendingSucceeded) {
    const cache = deps.loadCache();
    if (!cache) throw new NoUsableDataError("Live sources failed and no cache is usable");
    cachedSources.add("usaspending");
    candidates = cache.records;
    warnings.push(
      `Live search failed (${scout.usaspendingFailure ?? "no source responded"}). Showing cached public records retrieved ${cache.retrievedAt}, saved for the AquaVector demo profile, so they may not fit other profiles.`,
    );
  } else if (scout.usaspendingFailure) {
    warnings.push(`A USAspending search failed (${scout.usaspendingFailure}); results may be incomplete.`);
  }
  const snapshot = loadSnapshotIfSamUnavailable(profile, scout, deps);
  if (snapshot) {
    cachedSources.add("sam");
    // Live notices come first, so they win over a saved copy of the same notice.
    const liveNotices = candidates.filter((record) => record.source === "sam");
    const others = candidates.filter((record) => record.source !== "sam");
    candidates = collapseNotices(dedupeRecords([...liveNotices, ...snapshot.records, ...others])).slice(0, MAX_CANDIDATES);
    warnings.push(
      `SAM.gov is unavailable (${scout.samFailure ?? "not configured"}). Showing saved SAM.gov notices retrieved ${snapshot.retrievedAt}: check the source for updates.`,
    );
  } else if (!deps.samConfigured()) {
    warnings.push("SAM.gov is not configured: showing historical awards only, no open notices.");
  } else if (scout.samFailure) {
    warnings.push(`SAM.gov search failed (${scout.samFailure}): open notices may be missing.`);
  }

  const base = (results: RankedResult[]): ResearchResponse =>
    ResearchResponseSchema.parse({
      profile,
      dataMode: cachedSources.size > 0 ? "cached" : "live",
      ...(cachedSources.size > 0 ? { cachedSources: [...cachedSources] } : {}),
      recordsUsed: candidates.length,
      results,
      agentEvents,
      runAt: new Date(startedAt).toISOString(),
      warnings,
    });

  if (candidates.length === 0) {
    warnings.push("No matching records found. Try broader capability wording.");
    return base([]);
  }

  // Confirm each USAspending record at the source and add its set-aside. Cached ones already have this.
  const selected = selectForAnalysis(candidates, plan.searchTerms);
  let analyzed = selected;
  if (!cachedSources.has("usaspending")) {
    let lookupFailed = false;
    const checked = await Promise.all(
      selected.map(async (record) => {
        if (record.source !== "usaspending") return record;
        try {
          return await deps.enrich(record);
        } catch (error) {
          if (!(error instanceof UsaSpendingError)) throw error;
          lookupFailed = true;
          return record;
        }
      }),
    );
    analyzed = checked.filter((record): record is SourceRecord => record !== null);
    if (analyzed.length < selected.length) {
      warnings.push(`${selected.length - analyzed.length} record(s) removed: the source did not confirm their id.`);
    }
    if (lookupFailed) warnings.push("Some award details could not be loaded; set-aside may show as unknown.");
  }

  const assessments = await stage(
    "analyst",
    `Assessing ${analyzed.length} records against the profile`,
    () => deps.analyze(profile, analyzed, budget),
    (value) => `Assessed ${value.length} of ${analyzed.length} records, with verbatim evidence checks.`,
  );
  if (assessments.length < analyzed.length) {
    warnings.push(`The analyst skipped ${analyzed.length - assessments.length} record(s); those are left unscored.`);
  }
  const assessed = analyzed.filter((record) =>
    assessments.some((assessment) => assessment.sourceId === record.id),
  );

  let shortlist = await stage(
    "strategist",
    "Choosing the shortlist and next steps",
    () => deps.strategize(profile, assessed, assessments, budget),
    (value) => `Shortlisted ${value.length} records.`,
  );

  // The critic should judge the real scope, so shortlisted SAM notices get their text first.
  const shortlisted = shortlist.slice(0, SHORTLIST_SIZE);
  const shortlistedRecords = assessed.filter((record) => shortlisted.some((pick) => pick.sourceId === record.id));
  const [described, identity, buyerHistory] = await Promise.all([
    addNoticeDescriptions(assessed, shortlisted, deps, scout.samFailure, deps.loadSnapshot(profile.name)),
    deps.verify(shortlistedRecords),
    deps.history(shortlistedRecords),
  ]);
  const verdicts = await stage(
    "devils_advocate",
    `Independently challenging ${shortlist.length} shortlisted records`,
    () => deps.critique(profile, described.records, assessments, shortlist.slice(0, SHORTLIST_SIZE), budget),
    (value) => {
      const count = value.reduce((sum, verdict) => sum + verdict.findings.length, 0);
      return `Read ${described.count} SAM.gov description(s). Returned ${value.length} verdicts with ${count} findings.`;
    },
  );

  const recordById = new Map(described.records.map((record) => [record.id, record]));
  const findingsById: Record<string, AuditFinding[]> = {};
  for (const pick of shortlist) {
    const record = recordById.get(pick.sourceId);
    if (!record) continue;
    findingsById[pick.sourceId] = criticFindings(
      record,
      verdicts.find((verdict) => verdict.sourceId === pick.sourceId),
    ).concat(described.notes.get(pick.sourceId) ?? [], identity.get(pick.sourceId) ?? []);
  }

  // One revision at most, and only when the critic's objection held up and time remains.
  const challenged = Object.values(findingsById).some((list) =>
    list.some((finding) => finding.severity === "BLOCKER"),
  );
  if (challenged && deps.now() - startedAt < REVISION_CUTOFF_MS) {
    shortlist = await stage(
      "strategist",
      "Revising the shortlist after verified blockers",
      () => deps.revise(profile, shortlist, described.records, findingsById, budget),
      () => "Shortlist revised once.",
    );
  }

  const now = deps.now();
  const assessmentById = new Map(assessments.map((assessment) => [assessment.sourceId, assessment]));
  const picked = shortlist
    .map((pick) => {
      const record = recordById.get(pick.sourceId);
      if (!record) return null;
      // A "no verdict" warning comes from code, so only real critic output is subject to the cap.
      const reviewed = verdicts.some((verdict) => verdict.sourceId === pick.sourceId);
      const findings = findingsById[pick.sourceId] ?? [];
      return buildResult({
        record,
        profile,
        assessment: assessmentById.get(pick.sourceId),
        pick,
        extraFindings: reviewed ? [] : findings,
        critic: reviewed ? findings : [],
        priorAwards: buyerHistory.get(pick.sourceId),
        now,
      });
    })
    .filter((result): result is RankedResult => result !== null);
  // The deterministic score sets the order; the strategist decides what gets shortlisted.
  // HOLD results stay visible below the rest.
  picked.sort(
    (a, b) =>
      Number(a.reviewStatus === "HOLD") - Number(b.reviewStatus === "HOLD") || b.fitScore - a.fitScore,
  );

  const pickedIds = new Set(picked.map((result) => result.record.id));
  const others = assessed
    .filter((record) => !pickedIds.has(record.id))
    .map((record) =>
      buildResult({
        record,
        profile,
        assessment: assessmentById.get(record.id),
        pick: undefined,
        extraFindings: [
          {
            severity: "WARNING",
            issue: "Outside the shortlist: not reviewed by the Devil's Advocate",
            whyItMatters: "Only the top five get an independent challenge in each run.",
            evidenceSourceId: null,
            evidenceExcerpt: null,
            correctiveAction: "Needs verification against the source record.",
          },
        ],
        now,
      }),
    )
    .sort((a, b) => b.fitScore - a.fitScore);

  const results = [...picked, ...others].slice(0, MAX_RESULTS);
  return base(results);
}
