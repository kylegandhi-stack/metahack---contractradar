// Runbook section 9 acceptance suite. Records here are synthetic, titled [TEST], and never shown in
// the demo. T11's client side (retry UI) belongs to Builder 2; live runs are in tests/live-seeded.mts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { z } from "zod";
import { keepVerified, type Assessment } from "../lib/agents/analyst";
import { DEVILS_ADVOCATE_PROMPT } from "../lib/agents/devils-advocate";
import { NoUsableDataError, runResearch, type PipelineDeps } from "../lib/agents/orchestrator";
import type { ResearchPlan } from "../lib/agents/planner";
import type { ScoutResult } from "../lib/agents/scout";
import { clearScoutMemo, MAX_TOOL_TURNS, runScout } from "../lib/agents/scout";
import { loadVerifiedRecords } from "../lib/data/cache";
import { classifyNotice, normalizeNotice, searchNotices } from "../lib/data/sam";
import { cleanKeywords, dedupeRecords, normalizeAward, searchAwards } from "../lib/data/usaspending";
import { chatJson, MetaError, parseJsonOutput, RunBudget } from "../lib/meta";
import { applyGates, capCriticWarnings, isVerbatim, statusFromFindings, verifyCriticFinding } from "../lib/review";
import { ResearchResponseSchema, SourceRecordSchema } from "../lib/schemas";
import { computeFit, finalConfidence } from "../lib/scoring";
import type { AuditFinding, CompanyProfile, SourceRecord } from "../lib/types";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const PROFILE: CompanyProfile = {
  name: "[TEST] Sensor Co",
  capabilities: "Maker of hydrophones and underwater acoustic sensors.",
  smallBusiness: true,
  certifications: [],
};

function notice(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: "TEST-NOTICE-1",
    source: "sam",
    kind: "open_notice",
    title: "[TEST] Hydrophone assemblies",
    agency: "[TEST] Department of the Navy",
    description: null,
    url: "https://sam.gov/workspace/contract/opp/test/view",
    retrievedAt: "2026-11-03T11:00:00.000Z",
    postedAt: "2026-10-01",
    deadlineAt: "2026-11-30T16:30:00-05:00",
    awardAmount: null,
    setAside: null,
    naics: "334511",
    excerpts: [{ field: "title", text: "[TEST] Hydrophone assemblies" }],
    ...overrides,
  };
}

function award(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    ...notice(),
    id: "CONT_AWD_TEST_1",
    source: "usaspending",
    kind: "historical_award",
    title: "[TEST] Hydrophone delivery order",
    url: "https://www.usaspending.gov/award/CONT_AWD_TEST_1",
    deadlineAt: null,
    awardAmount: 100000,
    excerpts: [{ field: "Description", text: "[TEST] Hydrophone delivery order" }],
    ...overrides,
  };
}

const PLAN: ResearchPlan = {
  capabilities: ["hydrophones"],
  searchTerms: ["hydrophone"],
  categories: [],
  rationale: "test",
};

function assessment(sourceId: string, overrides: Partial<Assessment> = {}): Assessment {
  return {
    sourceId,
    technical: 30,
    category: 15,
    eligibility: 10,
    execution: 5,
    timing: 5,
    confidence: "high",
    whyMatched: ["Scope names hydrophones"],
    uncertainties: [],
    evidence: [{ field: "title", text: "[TEST] Hydrophone" }],
    ...overrides,
  };
}

function scoutWith(records: SourceRecord[], overrides: Partial<ScoutResult> = {}): ScoutResult {
  return {
    records,
    toolCalls: ["search_awards(hydrophone)"],
    turns: 1,
    usaspendingFailure: null,
    usaspendingSucceeded: true,
    samFailure: null,
    modelDirected: true,
    ...overrides,
  };
}

function fakeDeps(records: SourceRecord[], overrides: Partial<PipelineDeps> = {}): Partial<PipelineDeps> {
  return {
    plan: async () => PLAN,
    scout: async () => scoutWith(records),
    analyze: async (_profile, list) => list.map((record) => assessment(record.id)),
    strategize: async (_profile, list) =>
      list.slice(0, 5).map((record) => ({ sourceId: record.id, rationale: "Fits", nextSteps: ["Verify scope"] })),
    revise: async (_profile, shortlist) => shortlist,
    critique: async (_profile, _records, _assessments, shortlist) =>
      shortlist.map((pick) => ({ sourceId: pick.sourceId, verdict: "Checked", noneFound: true, findings: [] })),
    enrich: async (record) => record,
    samConfigured: () => true,
    now: () => NOW,
    ...overrides,
  };
}

const realFetch = globalThis.fetch;
const realSamKey = process.env.SAM_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realSamKey === undefined) delete process.env.SAM_API_KEY;
  else process.env.SAM_API_KEY = realSamKey;
  clearScoutMemo();
});

test("T1: a real-shaped award is historical, has no deadline, and gets no bid step", async () => {
  const record = normalizeAward(
    {
      generated_internal_id: "CONT_AWD_X_9700",
      "Award ID": "X",
      Description: "DT-574 HYDROPHONE",
      "Award Amount": 5,
      NAICS: { code: "334511", description: "NAV" },
      "Awarding Agency": "Department of Defense",
    },
    "2026-11-03T00:00:00.000Z",
  );
  assert.ok(record);
  assert.equal(record.kind, "historical_award");
  assert.equal(record.deadlineAt, null);
  assert.equal(record.url, "https://www.usaspending.gov/award/CONT_AWD_X_9700");
  assert.ok(record.excerpts.some((entry) => entry.field === "Description" && entry.text === "DT-574 HYDROPHONE"));

  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([award()], {
      strategize: async () => [
        {
          sourceId: "CONT_AWD_TEST_1",
          rationale: "Fits",
          nextSteps: ["Submit a proposal by Friday", "Apply now"],
        },
      ],
    }),
  });
  const [result] = response.results;
  assert.equal(result.record.kind, "historical_award");
  assert.equal(result.fitBreakdown?.timing, null);
  assert.equal(result.fitBreakdown?.eligibility, null);
  assert.ok(result.nextSteps.every((step) => !/submit|apply/i.test(step)));
});

test("T1: schema rejects a historical record labeled current or carrying a deadline", () => {
  assert.equal(SourceRecordSchema.safeParse(award({ kind: "open_notice" })).success, false);
  assert.equal(SourceRecordSchema.safeParse(award({ deadlineAt: "2027-01-01" })).success, false);
});

test("T2: solicitation types classify as open only by notice type", () => {
  assert.equal(classifyNotice("Solicitation"), "open_notice");
  assert.equal(classifyNotice("Combined Synopsis/Solicitation"), "open_notice");
  assert.equal(classifyNotice("Sources Sought"), "early_stage_notice");
  assert.equal(classifyNotice("Presolicitation"), "early_stage_notice");
  for (const other of ["Award Notice", "Justification", "Special Notice", "", null]) {
    assert.equal(classifyNotice(other), null);
  }
});

test("T2: a future solicitation passes with no deadline finding", () => {
  const gate = applyGates(notice({ setAside: "No Set aside used" }), PROFILE, 30, NOW);
  assert.equal(statusFromFindings(gate.findings), "APPROVED");
  assert.equal(gate.eligibility, "meets_known_requirements");
  assert.equal(applyGates(notice({ setAside: null }), PROFILE, 30, NOW).eligibility, "needs_verification");
});

test("T2: only official SAM links from the source are kept", () => {
  const raw = {
    noticeId: "abc",
    title: "T",
    type: "Solicitation",
    active: "Yes",
    uiLink: "https://sam.gov/workspace/contract/opp/abc/view",
  };
  assert.equal(normalizeNotice(raw, "2026-11-03T00:00:00.000Z")?.url, raw.uiLink);
  assert.equal(normalizeNotice({ ...raw, uiLink: "https://evil.example/abc" }, "2026-11-03T00:00:00.000Z"), null);
  assert.equal(normalizeNotice({ ...raw, active: "No" }, "2026-11-03T00:00:00.000Z"), null);
});

test("T3: an expired solicitation, even when active, gets a BLOCKER and HOLD", async () => {
  const expired = notice({ deadlineAt: "2026-10-22T16:30:00-04:00" });
  const gate = applyGates(expired, PROFILE, 30, NOW);
  const blocker = gate.findings.find((finding) => finding.severity === "BLOCKER");
  assert.equal(blocker?.evidenceExcerpt, "2026-10-22T16:30:00-04:00");

  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([expired, notice({ id: "TEST-NOTICE-2" })]),
  });
  const held = response.results.find((result) => result.record.id === expired.id);
  assert.equal(held?.reviewStatus, "HOLD");
  assert.equal(held?.confidence, "low");
  assert.equal(response.results.at(-1)?.record.id, expired.id, "HOLD sorts last and stays visible");
});

test("ambiguous or missing deadlines warn and never pass as open", () => {
  for (const deadlineAt of ["sometime soon", null]) {
    const { findings } = applyGates(notice({ deadlineAt }), PROFILE, 30, NOW);
    assert.equal(statusFromFindings(findings), "REVIEW_REQUIRED");
    assert.ok(findings.every((finding) => finding.severity !== "BLOCKER"));
  }
});

test("a deadline within 3 days warns", () => {
  const { findings } = applyGates(notice({ deadlineAt: "2026-11-04T12:00:00Z" }), PROFILE, 30, NOW);
  assert.equal(statusFromFindings(findings), "REVIEW_REQUIRED");
});

test("T4: an explicit set-aside against known company facts is a BLOCKER with evidence", () => {
  const setAside = "Total Small Business Set-Aside (FAR 19.5)";
  const gate = applyGates(notice({ setAside }), { ...PROFILE, smallBusiness: false }, 30, NOW);
  assert.equal(gate.eligibility, "known_blocker");
  assert.equal(statusFromFindings(gate.findings), "HOLD");
  assert.equal(gate.findings[0].evidenceExcerpt, setAside);
});

test("T5: a certification the company did not list is needs_verification, not ineligible", () => {
  for (const setAside of ["8(a) Set-Aside", "HUBZone Set-Aside", "Women-Owned Small Business (WOSB)"]) {
    const gate = applyGates(notice({ setAside }), PROFILE, 30, NOW);
    assert.equal(gate.eligibility, "needs_verification", setAside);
    assert.ok(gate.findings.every((finding) => finding.severity !== "BLOCKER"), setAside);
    assert.equal(statusFromFindings(gate.findings), "REVIEW_REQUIRED", setAside);
  }
});

test("T5: a listed certification raises no warning, unknown size asks for verification", () => {
  const held = applyGates(notice({ setAside: "8(a) Set-Aside" }), { ...PROFILE, certifications: ["8(a)"] }, 30, NOW);
  assert.equal(statusFromFindings(held.findings), "APPROVED");
  const unknownSize = applyGates(
    notice({ setAside: "Total Small Business" }),
    { ...PROFILE, smallBusiness: null },
    30,
    NOW,
  );
  assert.equal(unknownSize.eligibility, "needs_verification");
});

test("no set-aside text forms are not treated as restrictions", () => {
  for (const setAside of ["No Set aside used", "NO SET ASIDE USED.", "NONE", "None"]) {
    assert.equal(applyGates(notice({ setAside }), PROFILE, 30, NOW).eligibility, "meets_known_requirements", setAside);
  }
});

test("T6: same keyword but unrelated scope gets a low technical warning", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([notice({ title: "[TEST] Acoustic ceiling tile installation" })], {
      analyze: async (_profile, list) => list.map((record) => assessment(record.id, { technical: 4 })),
    }),
  });
  const [result] = response.results;
  assert.equal(result.fitBreakdown?.technical, 4);
  assert.notEqual(result.reviewStatus, "APPROVED");
  assert.ok(result.findings.some((finding) => /low technical/i.test(finding.issue)));
});

test("T7: identity problems block, and a non-verbatim BLOCKER cannot force HOLD", () => {
  const badHost = applyGates(notice({ url: "https://example.com/x" }), PROFILE, 30, NOW);
  assert.equal(statusFromFindings(badHost.findings), "HOLD");
  assert.equal(statusFromFindings(applyGates(notice({ excerpts: [] }), PROFILE, 30, NOW).findings), "HOLD");

  const record = notice();
  const invented = verifyCriticFinding(
    {
      severity: "BLOCKER",
      issue: "Requires top secret clearance",
      why_it_matters: "x",
      evidence_source_id: record.id,
      exact_supporting_excerpt: "Top secret clearance is required",
      proposed_correction: "Drop it",
    },
    record,
  );
  assert.equal(invented.severity, "WARNING");
  assert.equal(invented.evidenceExcerpt, null, "invented text is never displayed as evidence");

  const wrongSource = verifyCriticFinding(
    {
      severity: "BLOCKER",
      issue: "Mismatch",
      why_it_matters: "x",
      evidence_source_id: "OTHER",
      exact_supporting_excerpt: "[TEST] Hydrophone assemblies",
      proposed_correction: "Check",
    },
    record,
  );
  assert.equal(wrongSource.severity, "WARNING");
  assert.equal(wrongSource.evidenceSourceId, null);
});

test("T7: analyst evidence not found in the record is removed and lowers confidence", () => {
  const record = notice();
  const [kept] = keepVerified(
    [assessment(record.id, { evidence: [{ field: "title", text: "Invented requirement" }] })],
    [record],
  );
  assert.deepEqual(kept.evidence, []);
  assert.equal(kept.confidence, "low");
  assert.deepEqual(keepVerified([assessment("UNKNOWN-ID")], [record]), []);
  assert.equal(isVerbatim("[test]   hydrophone", record), true);
});

test("T8: every source down returns labeled cached public records, never invented ones", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([], {
      scout: async () =>
        scoutWith([], { usaspendingSucceeded: false, usaspendingFailure: "USAspending returned HTTP 500" }),
    }),
  });
  const cache = loadVerifiedRecords();
  assert.ok(cache);
  assert.equal(response.dataMode, "cached");
  assert.ok(response.warnings.some((warning) => warning.includes("HTTP 500") && warning.includes(cache.retrievedAt)));
  const ids = new Set(cache.records.map((record) => record.id));
  assert.ok(response.results.length > 0);
  assert.ok(response.results.every((result) => ids.has(result.record.id)));
});

test("T8: no cache gives a clear error, not an empty success", async () => {
  await assert.rejects(
    runResearch(PROFILE, {
      signal: new AbortController().signal,
      deps: fakeDeps([], {
        scout: async () => scoutWith([], { usaspendingSucceeded: false }),
        loadCache: () => null,
      }),
    }),
    NoUsableDataError,
  );
});

test("T8: missing SAM key warns, and a live empty search does not fall back to the cache", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([], { samConfigured: () => false }),
  });
  assert.equal(response.dataMode, "live");
  assert.deepEqual(response.results, []);
  assert.ok(response.warnings.some((warning) => warning.includes("historical awards only")));
  delete process.env.SAM_API_KEY;
  await assert.rejects(searchNotices({ title: "hydrophone" }), /not configured/);
});

test("T8: SAM errors never expose the key", async () => {
  process.env.SAM_API_KEY = "secret-test-key";
  globalThis.fetch = async () => new Response("{}", { status: 429 });
  const error = await searchNotices({ title: "hydrophone" }).catch((caught: Error) => caught);
  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes("secret-test-key"));
  assert.match(error.message, /429/);
});

test("T8: USAspending HTTP errors and malformed bodies raise instead of returning fake data", async () => {
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  await assert.rejects(searchAwards({ keywords: ["hydrophone"] }), /HTTP 500/);
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  await assert.rejects(searchAwards({ keywords: ["hydrophone"] }), /no results array/);
  globalThis.fetch = async () => {
    throw new Error("must not be called");
  };
  assert.deepEqual(await searchAwards({ keywords: ["ab", " "] }), [], "keywords under 3 chars are never sent");
  assert.deepEqual(cleanKeywords(["Sonar", "sonar ", "ab"]), ["Sonar"]);
});

test("T9: invalid model JSON is rejected before it reaches the pipeline", () => {
  const schema = z.object({ terms: z.array(z.string()) });
  assert.deepEqual(parseJsonOutput('{"terms":["a"]}', schema), { ok: true, value: { terms: ["a"] } });
  for (const bad of ["not json", '{"terms":"a"}', "", null]) {
    assert.equal(parseJsonOutput(bad, schema).ok, false);
  }
});

test("T10: a verified critic concern is visible on the result and sets its status", async () => {
  const record = notice();
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([record], {
      critique: async () => [
        {
          sourceId: record.id,
          verdict: "Bad",
          noneFound: false,
          findings: [
            {
              severity: "BLOCKER",
              issue: "Title contradicts the record",
              why_it_matters: "Identity mismatch",
              evidence_source_id: record.id,
              exact_supporting_excerpt: "[TEST] Hydrophone assemblies",
              proposed_correction: "Hold",
            },
          ],
        },
      ],
    }),
  });
  const [result] = response.results;
  assert.equal(result.reviewStatus, "HOLD");
  assert.deepEqual(result.blockers, ["Title contradicts the record"]);
  assert.equal(result.findings[0].evidenceExcerpt, "[TEST] Hydrophone assemblies");
  assert.ok(ResearchResponseSchema.safeParse(response).success);
});

test("T10: no verdict for a pick is a visible warning, never a clean approval", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([notice()], { critique: async () => [] }),
  });
  assert.equal(response.results[0].reviewStatus, "REVIEW_REQUIRED");
});

test("revision runs at most once, only for a verified blocker", async () => {
  let revisions = 0;
  const record = notice();
  await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([record], {
      revise: async (_profile, shortlist) => {
        revisions += 1;
        return shortlist;
      },
    }),
  });
  assert.equal(revisions, 0);
  await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([record], {
      revise: async (_profile, shortlist) => {
        revisions += 1;
        return shortlist;
      },
      critique: async () => [
        {
          sourceId: record.id,
          verdict: "Bad",
          noneFound: false,
          findings: [
            {
              severity: "BLOCKER",
              issue: "Problem",
              why_it_matters: "x",
              evidence_source_id: record.id,
              exact_supporting_excerpt: "[TEST] Hydrophone assemblies",
              proposed_correction: "Hold",
            },
          ],
        },
      ],
    }),
  });
  assert.equal(revisions, 1);
});

test("T11: an expired run budget stops with TIMEOUT instead of spinning", async () => {
  const controller = new AbortController();
  controller.abort();
  const budget = new RunBudget(controller.signal);
  assert.throws(
    () => budget.assertAvailable(),
    (error: unknown) => error instanceof MetaError && error.code === "TIMEOUT",
  );
  const exhausted = new RunBudget(undefined, 10);
  exhausted.record("analyst", 11);
  assert.throws(
    () => exhausted.assertAvailable(),
    (error: unknown) => error instanceof MetaError && error.code === "RATE_LIMITED",
  );
});

test("T12: two runs give stable ids and no duplicates", async () => {
  const records = [notice(), notice(), award(), notice({ id: "TEST-NOTICE-2" })];
  const run = () =>
    runResearch(PROFILE, {
      signal: new AbortController().signal,
      deps: fakeDeps(dedupeRecords(records)),
    });
  const [first, second] = [await run(), await run()];
  const ids = (response: typeof first) => response.results.map((result) => result.record.id);
  assert.deepEqual(ids(first), ids(second));
  assert.equal(new Set(ids(first)).size, ids(first).length);
  assert.equal(dedupeRecords(records).length, 3);
});

test("agentEvents are real, in pipeline order, and a failed stage is logged and thrown", async () => {
  const response = await runResearch(PROFILE, {
    signal: new AbortController().signal,
    deps: fakeDeps([notice()]),
  });
  const started = response.agentEvents.filter((event) => event.status === "started").map((event) => event.step);
  assert.deepEqual(started, ["planner", "scout", "analyst", "strategist", "devils_advocate"]);

  await assert.rejects(
    runResearch(PROFILE, {
      signal: new AbortController().signal,
      deps: fakeDeps([notice()], {
        analyze: async () => {
          throw new MetaError("RATE_LIMITED", "Meta API rate limit reached");
        },
      }),
    }),
    (error: unknown) => error instanceof MetaError && error.code === "RATE_LIMITED",
  );
});

test("scoring clamps, keeps unknowns null, and historical never scores timing or eligibility", () => {
  const notices = computeFit(
    { technical: 99, category: -5, eligibility: null, execution: 4.4, timing: 10 },
    "open_notice",
  );
  assert.deepEqual(notices.fitBreakdown, { technical: 40, category: 0, eligibility: null, execution: 4, timing: 10 });
  assert.equal(notices.fitScore, 54);
  const past = computeFit({ technical: 30, category: 10, eligibility: 20, execution: 5, timing: 10 }, "historical_award");
  assert.equal(past.fitBreakdown.eligibility, null);
  assert.equal(past.fitBreakdown.timing, null);
  assert.equal(past.fitScore, 45);
  assert.equal(finalConfidence("high", "HOLD"), "low");
  assert.equal(finalConfidence("high", "REVIEW_REQUIRED"), "medium");
  assert.equal(finalConfidence("low", "APPROVED"), "low");
});

test("the Devil's Advocate prompt matches the runbook apart from its intended changes", () => {
  const runbook = readFileSync(new URL("../docs/runbook.md", import.meta.url), "utf8");
  const asInRunbook = DEVILS_ADVOCATE_PROMPT.replace("Rauros Systems' Devil's", "ContractRadar's Devil's").replace(
    "Missing data alone is never a BLOCKER.",
    "Missing data alone is a WARNING.",
  );
  for (const line of asInRunbook.split("\n").filter((line) => line && !line.startsWith("SEVERITY:"))) {
    assert.ok(runbook.includes(line), line.slice(0, 40));
  }
  assert.ok(!DEVILS_ADVOCATE_PROMPT.includes("ContractRadar"));
  assert.ok(DEVILS_ADVOCATE_PROMPT.includes("Never drop a real issue"));
});

const warning = (issue: string, overrides: Partial<AuditFinding> = {}): AuditFinding => ({
  severity: "WARNING",
  issue,
  whyItMatters: "Test",
  evidenceSourceId: null,
  evidenceExcerpt: null,
  correctiveAction: "Check the source.",
  ...overrides,
});

test("the warning cap demotes the critic's excess to NOTE and deletes nothing", () => {
  const critic = [warning("a"), warning("b"), warning("c"), warning("d")];
  const capped = capCriticWarnings(critic, new Set(critic));
  assert.deepEqual(capped.map((finding) => finding.issue), ["a", "b", "c", "d"]);
  assert.deepEqual(capped.map((finding) => finding.severity), ["WARNING", "WARNING", "NOTE", "NOTE"]);
});

test("the warning cap keeps the strongest critic warnings first", () => {
  const plain = warning("plain");
  const excerpt = warning("excerpt", { evidenceExcerpt: "text" });
  const unverified = warning("unverified contradiction", { correctiveAction: "Needs verification. Check it." });
  const critic = [plain, excerpt, unverified];
  const kept = capCriticWarnings(critic, new Set(critic)).filter((finding) => finding.severity === "WARNING");
  assert.deepEqual(kept.map((finding) => finding.issue), ["excerpt", "unverified contradiction"]);
});

test("the warning cap counts code warnings first and never demotes them or a BLOCKER", () => {
  const gate = [warning("gate 1"), warning("gate 2"), warning("gate 3")];
  const blocker = warning("blocker", { severity: "BLOCKER" });
  const critic = [blocker, warning("critic")];
  const capped = capCriticWarnings([...gate, ...critic], new Set(critic));
  assert.deepEqual(capped.map((finding) => finding.severity), ["WARNING", "WARNING", "WARNING", "BLOCKER", "NOTE"]);
});

test("the warning cap never changes the review status", () => {
  for (let count = 0; count <= 5; count += 1) {
    const critic = Array.from({ length: count }, (_, index) => warning(`w${index}`));
    assert.equal(statusFromFindings(capCriticWarnings(critic, new Set(critic))), statusFromFindings(critic));
  }
});

test("the saved cache is valid, verbatim-shaped and only real-source historical records", () => {
  const cache = loadVerifiedRecords();
  assert.ok(cache);
  assert.ok(cache.records.length >= 10 && cache.records.length <= 20);
  for (const record of cache.records) {
    assert.ok(!record.title.includes("[TEST]") && !record.title.includes("[SAMPLE]"));
    assert.ok(record.url.endsWith(record.id));
    assert.equal(record.kind, "historical_award");
  }
});

// The OpenAI client keeps the fetch it first sees, so model traffic goes through a swappable handler.
let modelHandler: (body: Record<string, unknown>) => unknown = () => ({});
let modelCalls = 0;
const modelFetch: typeof fetch = async (_url, init) => {
  modelCalls += 1;
  const reply = modelHandler(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
};
function completion(message: Record<string, unknown>) {
  return {
    id: "test",
    object: "chat.completion",
    created: 0,
    model: "muse-spark-1.3",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", ...message } }],
    usage: { total_tokens: 10 },
  };
}
function useFakeModel(handler: typeof modelHandler) {
  process.env.MODEL_API_KEY ??= "test-key";
  modelHandler = handler;
  modelCalls = 0;
  globalThis.fetch = modelFetch;
}

test("T9: invalid output gets exactly one retry, then a graceful failure", async () => {
  const schema = z.object({ terms: z.array(z.string()) });
  const call = () =>
    chatJson({ stage: "planner", budget: new RunBudget(), schema, system: "s", user: "u" });

  useFakeModel(() => completion({ content: "not json" }));
  await assert.rejects(call(), (error: unknown) => error instanceof MetaError && error.code === "UPSTREAM_ERROR");
  assert.equal(modelCalls, 2);

  let attempts = 0;
  useFakeModel(() => {
    attempts += 1;
    return completion({ content: attempts === 1 ? "{bad" : '{"terms":["sonar"]}' });
  });
  assert.deepEqual(await call(), { terms: ["sonar"] });
  assert.equal(modelCalls, 2);
});

test("the scout stops at the tool-round cap and dedupes across rounds", async () => {
  delete process.env.SAM_API_KEY;
  let round = 0;
  useFakeModel((body) => {
    assert.equal(body.model, "muse-spark-1.3");
    round += 1;
    return completion({
      content: null,
      tool_calls: [
        {
          id: `call-${round}`,
          type: "function",
          function: { name: "search_awards", arguments: JSON.stringify({ keywords: [`term${round}`] }) },
        },
      ],
    });
  });
  const model = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("usaspending")) {
      return Response.json({
        results: [{ generated_internal_id: "CONT_AWD_SAME", Description: "[TEST] same award" }],
      });
    }
    return model(url, init);
  };
  const result = await runScout(PLAN, new RunBudget());
  assert.equal(result.turns, MAX_TOOL_TURNS);
  assert.equal(round, MAX_TOOL_TURNS);
  assert.equal(result.records.length, 1);
  assert.equal(result.toolCalls.length, MAX_TOOL_TURNS);
  assert.equal(result.modelDirected, true);
});

test("the scout says so when the model made no tool call, and offers no SAM tool without a key", async () => {
  delete process.env.SAM_API_KEY;
  useFakeModel((body) => {
    const tools = body.tools as { function: { name: string } }[];
    assert.deepEqual(tools.map((tool) => tool.function.name), ["search_awards"]);
    return completion({ content: "done" });
  });
  const model = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    String(url).includes("usaspending") ? Response.json({ results: [] }) : model(url, init);
  const result = await runScout(PLAN, new RunBudget());
  assert.equal(result.modelDirected, false);
  assert.equal(result.turns, 0);
});
