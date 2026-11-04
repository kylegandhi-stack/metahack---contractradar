// Saves real SAM.gov notices and shortlist descriptions for a demo profile to data/sam-snapshot.json.
// Production uses this file only on a 429 or a missing key, labeled as cached. Never edit its facts by
// hand: rerun this script instead. Spends up to 6 SAM.gov calls and one full model run per profile.
// Usage: npx tsx --env-file=.env.local scripts/fetch-sam-snapshot.mts
// Saved descriptions have emails, phone numbers and the sentences holding them removed. To apply that to the existing file with no
// network calls: npx tsx scripts/fetch-sam-snapshot.mts --scrub-only
import { readFileSync, writeFileSync } from "node:fs";
import { describeNotices } from "../lib/data/sam";
import { runResearch } from "../lib/agents/orchestrator";
import { runScout } from "../lib/agents/scout";
import { scrubDescriptions } from "../lib/data/scrub-contacts";
import { SamSnapshotSchema } from "../lib/schemas";
import type { CompanyProfile, SourceRecord } from "../lib/types";

const OUTPUT = new URL("../data/sam-snapshot.json", import.meta.url);

if (process.argv.includes("--scrub-only")) {
  const saved = SamSnapshotSchema.parse(JSON.parse(readFileSync(OUTPUT, "utf8")));
  for (const profile of Object.values(saved.profiles)) profile.descriptions = scrubDescriptions(profile.descriptions);
  writeFileSync(OUTPUT, `${JSON.stringify(SamSnapshotSchema.parse(saved), null, 2)}\n`);
  console.log("Removed contact details from saved descriptions. No network calls were made.");
  process.exit(0);
}

const MAX_DESCRIPTIONS = 4;
const MAX_SAM_CALLS = 2 + MAX_DESCRIPTIONS; // 2 searches. Hard stop, so the key's budget can't be overrun.

// This adds SAM.gov calls, and a capture doesn't need it.
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

// Must match AQUAVECTOR_PRESET in components/ProfileForm.tsx, since the file is keyed by this name.
const PROFILE: CompanyProfile = {
  name: "AquaVector Systems",
  capabilities:
    "12-person U.S. maker of hydrophones, underwater acoustic sensors, environmental monitoring instruments, and ruggedized components for autonomous underwater vehicles.",
  smallBusiness: true,
  certifications: [],
  targetAgencies: ["Department of the Navy"],
};

let notices: SourceRecord[] = [];
let samFailure: string | null = null;
let descriptions: Record<string, string> = {};
let shortened: string[] = [];

await runResearch(PROFILE, {
  signal: AbortSignal.timeout(180_000),
  deps: {
    descriptionsEnabled: () => true, // A capture always fetches them, whatever the production setting.
    scout: async (plan, budget) => {
      const result = await runScout(plan, budget);
      notices = result.records.filter((record) => record.source === "sam");
      samFailure = result.samFailure;
      return result;
    },
    describe: async (records) => {
      const result = await describeNotices(records.slice(0, MAX_DESCRIPTIONS));
      descriptions = Object.fromEntries(result.texts);
      shortened = result.shortened;
      return result;
    },
  },
});

if (samFailure || notices.length === 0) {
  console.error(`No usable SAM.gov notices (${samFailure ?? "search returned none"}). Nothing written.`);
  process.exit(1);
}

const file = SamSnapshotSchema.parse(JSON.parse(readFileSync(OUTPUT, "utf8")));
file.profiles[PROFILE.name] = {
  retrievedAt: notices.map((record) => record.retrievedAt).sort()[0],
  records: notices,
  descriptions: scrubDescriptions(descriptions),
  shortened,
};
writeFileSync(OUTPUT, `${JSON.stringify(SamSnapshotSchema.parse(file), null, 2)}\n`);
console.log(`Saved ${notices.length} notices and ${Object.keys(descriptions).length} descriptions for ${PROFILE.name}. SAM.gov calls: ${samCalls}.`);
