// Pure metrics for the eval runner. Labels come from people, never from a model.
import { z } from "zod";
import { CompanyProfileSchema } from "./schemas";
import type { RankedResult } from "./types";

// Hand labels list each record with a reason. Award-history keys list what a real supplier won.
export const EvalFileSchema = z.object({
  profile: z.union([z.string(), CompanyProfileSchema]),
  companyProfile: CompanyProfileSchema.optional(),
  source: z.enum(["hand_label", "award_history"]),
  labels: z
    .array(z.object({ id: z.string(), label: z.enum(["relevant", "not_relevant"]), reason: z.string().optional() }))
    .optional(),
  relevantIds: z.array(z.string()).optional(),
  notRelevantIds: z.array(z.string()).optional(),
});
export type EvalFile = z.infer<typeof EvalFileSchema>;

export type EvalMetrics = {
  // Precision over labeled records only, so null when no top-5 record has a label.
  precisionAt5: number | null;
  top5Labeled: number;
  top5Relevant: number;
  top5Unlabeled: number;
  recallAt10: number | null;
  relevantFoundIn10: number;
  relevantTotal: number;
  expiredNotices: number;
  expiredOnHold: number;
  expiredHoldRate: number | null;
};

export function computeMetrics(file: EvalFile, results: RankedResult[], now: number): EvalMetrics {
  const relevant = new Set([
    ...(file.relevantIds ?? []),
    ...(file.labels ?? []).filter((entry) => entry.label === "relevant").map((entry) => entry.id),
  ]);
  const notRelevant = new Set([
    ...(file.notRelevantIds ?? []),
    ...(file.labels ?? []).filter((entry) => entry.label === "not_relevant").map((entry) => entry.id),
  ]);
  const ids = results.map((result) => result.record.id);
  const top5 = ids.slice(0, 5);
  const top5Relevant = top5.filter((id) => relevant.has(id)).length;
  const top5Labeled = top5.filter((id) => relevant.has(id) || notRelevant.has(id)).length;
  const relevantFoundIn10 = ids.slice(0, 10).filter((id) => relevant.has(id)).length;
  const expired = results.filter((result) => {
    const deadline = result.record.deadlineAt ? Date.parse(result.record.deadlineAt) : Number.NaN;
    return !Number.isNaN(deadline) && deadline <= now;
  });
  const expiredOnHold = expired.filter((result) => result.reviewStatus === "HOLD").length;
  return {
    precisionAt5: top5Labeled > 0 ? top5Relevant / top5Labeled : null,
    top5Labeled,
    top5Relevant,
    top5Unlabeled: top5.length - top5Labeled,
    recallAt10: relevant.size > 0 ? relevantFoundIn10 / relevant.size : null,
    relevantFoundIn10,
    relevantTotal: relevant.size,
    expiredNotices: expired.length,
    expiredOnHold,
    expiredHoldRate: expired.length > 0 ? expiredOnHold / expired.length : null,
  };
}

// Reads the labeling sheet: quoted CSV, as a spreadsheet saves it. Blank answers stay unlabeled.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

export type SheetScore = {
  profile: string;
  top5Labeled: number;
  top5Relevant: number;
  precisionAt5: number | null;
  labeled: number;
  relevant: number;
  precisionAll: number | null;
  blank: number;
  invalid: number;
};

export function scoreSheet(csv: string): SheetScore[] {
  const [header, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ""));
  const column = (name: string) => header.findIndex((cell) => cell.trim().toLowerCase().startsWith(name));
  const [profileAt, rankAt, answerAt] = [column("profile"), column("rank"), column("relevant")];
  if (profileAt < 0 || rankAt < 0 || answerAt < 0) throw new Error("The sheet needs profile, rank and relevant columns");
  const scores = new Map<string, SheetScore>();
  for (const row of rows) {
    const profile = row[profileAt];
    const score = scores.get(profile) ?? {
      profile,
      top5Labeled: 0,
      top5Relevant: 0,
      precisionAt5: null,
      labeled: 0,
      relevant: 0,
      precisionAll: null,
      blank: 0,
      invalid: 0,
    };
    scores.set(profile, score);
    const answer = (row[answerAt] ?? "").trim().toLowerCase();
    if (!answer) {
      score.blank += 1;
      continue;
    }
    const yes = answer === "y" || answer === "yes";
    if (!yes && answer !== "n" && answer !== "no") {
      score.invalid += 1;
      continue;
    }
    score.labeled += 1;
    if (yes) score.relevant += 1;
    if (Number(row[rankAt]) <= 5) {
      score.top5Labeled += 1;
      if (yes) score.top5Relevant += 1;
    }
  }
  for (const score of scores.values()) {
    score.precisionAt5 = score.top5Labeled > 0 ? score.top5Relevant / score.top5Labeled : null;
    score.precisionAll = score.labeled > 0 ? score.relevant / score.labeled : null;
  }
  return [...scores.values()];
}
