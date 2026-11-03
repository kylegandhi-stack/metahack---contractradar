// Tue 3 PM gate: does the real model catch seeded flaws? Calls the real Devil's Advocate on synthetic
// [TEST] records (never shown in the demo). Costs a few cents. Usage: npm run test:live
import { runDevilsAdvocate } from "../lib/agents/devils-advocate";
import { RunBudget } from "../lib/meta";
import { verifyCriticFinding } from "../lib/review";
import type { CompanyProfile, SourceRecord } from "../lib/types";

const profile: CompanyProfile = {
  name: "AquaVector Systems",
  capabilities: "12-person U.S. maker of hydrophones, underwater acoustic sensors, and AUV components.",
  smallBusiness: true,
  certifications: [],
};
const record = (id: string, title: string, overrides: Partial<SourceRecord>): SourceRecord => ({
  id,
  source: "sam",
  kind: "open_notice",
  title,
  agency: "[TEST] Department of the Navy",
  description: null,
  url: `https://sam.gov/workspace/contract/opp/${id}/view`,
  retrievedAt: new Date().toISOString(),
  postedAt: "2026-06-01",
  deadlineAt: "2027-02-01T17:00:00-05:00",
  awardAmount: null,
  setAside: null,
  naics: "334511",
  excerpts: [{ field: "title", text: title }],
  ...overrides,
});

const seeded = [
  {
    expected: "expired deadline",
    record: (() => {
      const title = "[TEST] Hydrophone assemblies";
      const deadline = "2026-01-15T17:00:00-05:00";
      return record("TEST-EXPIRED", title, {
        deadlineAt: deadline,
        excerpts: [
          { field: "title", text: title },
          { field: "responseDeadLine", text: deadline },
        ],
      });
    })(),
    rationale: "Open solicitation that AquaVector should bid on now.",
  },
  {
    expected: "unrelated scope behind a shared keyword",
    record: record("TEST-KEYWORD", "[TEST] Acoustic ceiling tile installation, Building 12", { naics: "238310" }),
    rationale: "Strong acoustic match for AquaVector's acoustic sensor line.",
  },
  {
    expected: "unsupported claim about the buyer's budget and win chances",
    record: record("TEST-CLAIM", "[TEST] Hydrophone calibration services", {}),
    rationale: "The Navy has $40M available for this and AquaVector has a 90% chance of winning.",
  },
  {
    expected: "historical award presented as open",
    record: record("TEST-HISTORICAL", "[TEST] Hydrophone delivery order", {
      source: "usaspending",
      kind: "historical_award",
      url: "https://www.usaspending.gov/award/TEST-HISTORICAL",
      deadlineAt: null,
      awardAmount: 250_000,
    }),
    rationale: "Open opportunity: AquaVector should submit a bid on this hydrophone order now.",
  },
];

const records = seeded.map((entry) => entry.record);
const shortlist = seeded.map((entry) => ({
  sourceId: entry.record.id,
  rationale: entry.rationale,
  nextSteps: ["Prepare a bid"],
}));
const assessments = records.map((entry) => ({
  sourceId: entry.id,
  technical: 38,
  technicalExcerpt: null,
  eligibility: 18,
  execution: 9,
  timing: 9,
  confidence: "high" as const,
  whyMatched: ["Excellent match"],
  uncertainties: [],
  evidence: [],
}));

const verdicts = await runDevilsAdvocate(
  profile,
  records,
  assessments,
  shortlist,
  new RunBudget(AbortSignal.timeout(90_000)),
);

let caught = 0;
for (const entry of seeded) {
  const verdict = verdicts.find((item) => item.sourceId === entry.record.id);
  const findings = (verdict?.findings ?? []).map((finding) => verifyCriticFinding(finding, entry.record));
  const serious = findings.filter((finding) => finding.severity !== "NOTE");
  if (serious.length > 0) caught += 1;
  console.log(`\n${entry.record.id} (seeded: ${entry.expected}): ${serious.length ? "CAUGHT" : "MISSED"}`);
  for (const finding of findings) console.log(`  ${finding.severity}: ${finding.issue.slice(0, 140)}`);
}
console.log(`\n${caught}/${seeded.length} seeded flaws raised a WARNING or BLOCKER`);
process.exit(caught === seeded.length ? 0 : 1);
