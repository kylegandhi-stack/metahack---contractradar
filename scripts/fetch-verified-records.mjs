// Saves real USAspending records for the AquaVector demo profile to data/verified-records.json.
// This is the cached fallback for POST /api/research, so records are written exactly as the source
// returned them. Never edit facts in the output by hand: rerun this script instead.
// Usage: npx tsx scripts/fetch-verified-records.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dedupeRecords,
  enrichWithAwardDetail,
  searchAwards,
} from "../lib/data/usaspending.ts";

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "verified-records.json");
const MIN_RECORDS = 10;
const MAX_RECORDS = 20;
const PER_TERM = 8;

// Taken from the AquaVector capability statement in docs/runbook.md section 3.
const TERMS = [
  "hydrophone",
  "underwater acoustic",
  "acoustic sensor",
  "autonomous underwater vehicle",
  "environmental monitoring instrument",
];

const perTerm = [];
for (const term of TERMS) {
  const records = await searchAwards({ keywords: [term], limit: PER_TERM });
  console.log(`${term}: ${records.length} records`);
  perTerm.push(records);
}

// Round-robin across terms so the cap does not fill up with the first term only.
const candidates = [];
for (let i = 0; i < PER_TERM; i += 1) {
  for (const records of perTerm) {
    if (records[i]) candidates.push(records[i]);
  }
}

const records = [];
let dropped = 0;
for (const record of dedupeRecords(candidates)) {
  if (records.length >= MAX_RECORDS) break;
  const verified = await enrichWithAwardDetail(record);
  if (verified) records.push(verified);
  else dropped += 1;
}

if (records.length < MIN_RECORDS) {
  console.error(`Only ${records.length} verified records (need ${MIN_RECORDS}). Nothing written.`);
  process.exit(1);
}

const retrievedAt = records.map((record) => record.retrievedAt).sort()[0];
writeFileSync(
  OUTPUT,
  `${JSON.stringify({ source: "usaspending", retrievedAt, searchTerms: TERMS, records }, null, 2)}\n`,
);
console.log(`Wrote ${records.length} records (${dropped} dropped by source check) to ${OUTPUT}`);
