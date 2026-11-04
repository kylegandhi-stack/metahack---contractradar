// Runs the AquaVector preset on the current code and writes a fresh labeling sheet, to compare with the
// hand-labeled runs from before the accuracy changes. Run it once, after the SAM.gov quota resets.
// Uses at most 2 SAM.gov calls and one model run (about $0.10 estimated), with a hard stop on a 3rd call.
// Usage: npx tsx --env-file=.env.local scripts/labeling-sheet-after.mts [--force] [--out=path]
// Score it after labeling: npm run eval:sheet data/eval/labeling-sheet-after.csv
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runResearch } from "../lib/agents/orchestrator";
import type { CompanyProfile, RankedResult } from "../lib/types";

const MAX_SAM_CALLS = 2;
const args = process.argv.slice(2);
const out = args.find((arg) => arg.startsWith("--out="))?.slice(6) ?? "data/eval/labeling-sheet-after.csv";

// Must match AQUAVECTOR_PRESET in components/ProfileForm.tsx, which is checked below.
const PROFILE: CompanyProfile = {
  name: "AquaVector Systems",
  capabilities:
    "12-person U.S. maker of hydrophones, underwater acoustic sensors, environmental monitoring instruments, and ruggedized components for autonomous underwater vehicles.",
  smallBusiness: true,
  certifications: [],
  targetAgencies: ["Department of the Navy"],
};

function stop(message: string): never {
  console.error(`Stopped: ${message}`);
  process.exit(1);
}

// Everything that could waste a SAM.gov call is checked before the first one.
const preset = readFileSync(new URL("../components/ProfileForm.tsx", import.meta.url), "utf8");
if (!preset.includes(PROFILE.capabilities) || !preset.includes(`"${PROFILE.targetAgencies?.[0]}"`)) {
  stop("this profile no longer matches AQUAVECTOR_PRESET, so update it first. No calls were made.");
}
if (!process.env.SAM_API_KEY?.trim()) stop("SAM_API_KEY is not set, so there would be no notices. No calls were made.");
if (existsSync(out) && !args.includes("--force")) stop(`${out} already exists, so use --force to replace it. No calls were made.`);

// These add SAM.gov calls, and a comparison doesn't need them.
delete process.env.SAM_DESCRIPTIONS;
delete process.env.SAM_IDENTITY_LOOKUPS;

let samCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).hostname === "api.sam.gov") {
    samCalls += 1;
    if (samCalls > MAX_SAM_CALLS) return Promise.reject(new Error(`More than ${MAX_SAM_CALLS} SAM.gov calls`));
  }
  return realFetch(input, init);
};

const startedAt = Date.now();
const response = await runResearch(PROFILE, { signal: AbortSignal.timeout(180_000) });
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`SAM.gov calls: ${samCalls}. Run time: ${seconds} s. Data: ${response.dataMode}.`);

// Saved first, so a failed write or a stop below can't lose a run that already spent its SAM.gov calls.
const raw = `${out.replace(/\.csv$/, "")}.raw.json`;
writeFileSync(raw, `${JSON.stringify({ samCalls, seconds: Number(seconds), response }, null, 2)}\n`);
console.log(`Raw results: ${raw}`);

// A sheet without live SAM.gov data can't be compared with the earlier runs, so it isn't written.
const samProblem = response.warnings.find((warning) => warning.includes("SAM.gov"));
if (response.dataMode !== "live" || samProblem) stop(`SAM.gov wasn't fully live: ${samProblem ?? response.dataMode}. Nothing written.`);

const cell = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const row = (result: RankedResult, index: number) => [
  PROFILE.name,
  index + 1,
  "",
  result.record.title.replace(/�+/g, " "),
  result.record.kind,
  result.reviewStatus,
  result.fitScore,
  (result.record.agency ?? "").split(/\.| \/ /).pop(),
  result.record.naics,
  result.record.deadlineAt,
  result.record.url,
  result.record.id,
];
const top = response.results.slice(0, 10);
const header = ["profile", "rank", "relevant (y/n)", "title", "kind", "status", "fit", "agency", "naics", "deadline", "source_url", "record_id"];
writeFileSync(out, `${[header, ...top.map(row)].map((cells) => cells.map(cell).join(",")).join("\n")}\n`);

for (const [index, result] of top.entries()) {
  const { record } = result;
  console.log(`${String(index + 1).padStart(2)}. ${record.title.slice(0, 62).padEnd(62)} ${record.kind.padEnd(18)} ${result.reviewStatus}`);
}
const notices = top.filter((result) => result.record.source === "sam").length;
console.log(`\n${notices} of ${top.length} are SAM.gov notices. Sheet: ${out}. Fill in "relevant (y/n)", then run: npm run eval:sheet ${out}`);
if (notices === 0) console.log("No notices in the top 10, so this can't be compared fairly with the earlier run.");
