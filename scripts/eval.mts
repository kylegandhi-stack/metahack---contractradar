// Scores the pipeline against labeled records in data/eval/*.json. Spends real model tokens.
// npm run eval                 Replay: fixed saved records, so it measures ranking and is repeatable. No SAM.gov calls.
// npm run eval -- --live       Live USAspending search too, so it also measures retrieval. No SAM.gov calls.
// npm run eval -- --with-sam   Live SAM.gov as well. Spends up to 2 calls per run from a small daily quota, or 7 with SAM_DESCRIPTIONS=on.
// Options: --runs=N (default 1), --file=aquavector
import { readdirSync, readFileSync } from "node:fs";
import { runResearch } from "../lib/agents/orchestrator";
import { loadVerifiedRecords } from "../lib/data/cache";
import { computeMetrics, EvalFileSchema } from "../lib/eval";
import type { CompanyProfile } from "../lib/types";

const args = process.argv.slice(2);
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const withSam = args.includes("--with-sam");
const live = withSam || args.includes("--live");
const runs = Number(option("runs") ?? 1);
const only = option("file");
if (!withSam) delete process.env.SAM_API_KEY;

const directory = new URL("../data/eval/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".json") && (!only || name === `${only}.json`));
const percent = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);

console.log(`Mode: ${withSam ? "live USAspending and SAM.gov" : live ? "live USAspending, no SAM.gov" : "replay of saved records"}`);
for (const name of files) {
  const file = EvalFileSchema.parse(JSON.parse(readFileSync(new URL(name, directory), "utf8")));
  const profile = (file.companyProfile ?? file.profile) as CompanyProfile;
  if (typeof profile === "string") throw new Error(`${name}: a text profile needs companyProfile`);
  for (let run = 1; run <= runs; run += 1) {
    const startedAt = Date.now();
    const response = await runResearch(profile, {
      signal: AbortSignal.timeout(180_000),
      deps: live
        ? {}
        : {
            scout: async () => ({
              records: loadVerifiedRecords()?.records ?? [],
              toolCalls: ["replay"],
              turns: 0,
              usaspendingFailure: null,
              usaspendingSucceeded: true,
              samFailure: null,
              samThrottled: false,
              modelDirected: false,
            }),
            enrich: async (record) => record,
          },
    });
    const m = computeMetrics(file, response.results, Date.now());
    console.log(`\n${name} run ${run}/${runs} (${((Date.now() - startedAt) / 1000).toFixed(1)} s, ${response.dataMode})`);
    console.log(`  precision@5: ${percent(m.precisionAt5)} (${m.top5Relevant} relevant of ${m.top5Labeled} labeled; ${m.top5Unlabeled} unlabeled in top 5, not counted)`);
    console.log(`  recall@10: ${percent(m.recallAt10)} (${m.relevantFoundIn10} of ${m.relevantTotal} known relevant in top 10)`);
    console.log(`  expired notices on HOLD: ${percent(m.expiredHoldRate)} (${m.expiredOnHold} of ${m.expiredNotices})`);
    const buyers = new Set(response.results.map((result) => (result.record.agency ?? "unknown").split(" / ")[0]));
    console.log(`  buyers in results: ${[...buyers].join("; ")}`);
    for (const result of response.results.slice(0, 5)) {
      const entry = file.labels?.find((label) => label.id === result.record.id);
      console.log(`    ${(entry?.label ?? "unlabeled").padEnd(12)} ${result.fitScore} ${result.record.title.slice(0, 60)}`);
    }
    // Ids to hand to a person for labeling. Labels never come from this script.
    const known = new Set([...(file.labels ?? []).map((label) => label.id), ...(file.relevantIds ?? []), ...(file.notRelevantIds ?? [])]);
    for (const result of response.results.filter((item) => !known.has(item.record.id))) {
      console.log(`  to label: ${result.record.id} | ${result.record.title.slice(0, 70)}`);
    }
  }
}
