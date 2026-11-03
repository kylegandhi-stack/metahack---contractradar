// Scores the filled-in labeling sheet. No model, network or SAM.gov calls.
// Usage: npm run eval:sheet [path], default data/eval/labeling-sheet.csv
import { readFileSync } from "node:fs";
import { scoreSheet } from "../lib/eval";

const path = process.argv[2] ?? "data/eval/labeling-sheet.csv";
const percent = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
for (const s of scoreSheet(readFileSync(path, "utf8"))) {
  console.log(s.profile);
  console.log(`  precision@5: ${percent(s.precisionAt5)} (${s.top5Relevant} of ${s.top5Labeled} labeled)`);
  console.log(`  all rows: ${percent(s.precisionAll)} relevant (${s.relevant} of ${s.labeled} labeled)`);
  if (s.blank) console.log(`  not labeled yet: ${s.blank}`);
  if (s.invalid) console.log(`  answers that are not y or n, ignored: ${s.invalid}`);
}
