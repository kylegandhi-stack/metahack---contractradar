// Past USAspending awards from a notice's buyer for comparable items. Facts from records, never
// inferred. These are similar past buys, not proof of an incumbent on this notice. Agency and code
// alone return unrelated items and title words alone match the wrong things, so all three must agree.
// No history is better than wrong history, so any failure or doubt returns an empty list.
import type { PriorAward, SourceRecord } from "../types";
import { SEARCH_URL } from "./usaspending";

const TIMEOUT_MS = 5_000;
const LOOKBACK_YEARS = 5;
const MAX_PRIOR_AWARDS = 5;
const SEARCH_LIMIT = 25;
const MAX_TERMS = 3;
const GENERIC_WORDS = new Set(
  "and or of for the a an to in with similar replacement parts part spare spares assembly assemblies supply supplies service services repair kit kits gtc unit units".split(" "),
);
const LOWERCASE_WORDS = new Set(["of", "the", "and", "for"]);

// SAM.gov path "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVSUP" gives USAspending's "Department of the Navy".
export function subtierFromPath(path: string | null | undefined): string | null {
  const segment = path?.split(".")[1]?.trim();
  if (!segment) return null;
  return segment
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => {
      if (word === "dept") return "Department";
      if (index > 0 && LOWERCASE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function titleTerms(title: string): string[] {
  return title
    .replace(/^\s*\d+\s*--\s*/, "")
    .split(/[^A-Za-z0-9-]+/)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word.toLowerCase()))
    .slice(0, MAX_TERMS);
}

const escapeForRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

type RawPriorAward = {
  generated_internal_id?: string | null;
  Description?: string | null;
  "Recipient Name"?: string | null;
  "Award Amount"?: number | null;
  "Start Date"?: string | null;
};

export async function findPriorAwards(record: SourceRecord, now = Date.now()): Promise<PriorAward[]> {
  const subtier = subtierFromPath(record.agency);
  const psc = record.excerpts.find((excerpt) => excerpt.field === "classificationCode")?.text.trim();
  const terms = titleTerms(record.title);
  if (!subtier || !psc || terms.length === 0) return [];

  const today = new Date(now).toISOString().slice(0, 10);
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - LOOKBACK_YEARS);
  const earliest = start.toISOString().slice(0, 10);
  let results: unknown;
  try {
    const response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        filters: {
          keywords: terms,
          psc_codes: [psc],
          agencies: [{ type: "awarding", tier: "subtier", name: subtier }],
          award_type_codes: ["A", "B", "C", "D"],
          time_period: [{ start_date: earliest, end_date: today }],
        },
        fields: ["Award ID", "Recipient Name", "Award Amount", "Description", "Start Date", "generated_internal_id"],
        limit: SEARCH_LIMIT,
        page: 1,
        sort: "Start Date",
        order: "desc",
        subawards: false,
      }),
    });
    if (!response.ok) return [];
    results = ((await response.json()) as { results?: unknown }).results;
  } catch {
    return [];
  }
  if (!Array.isArray(results)) return [];

  // USAspending matches keywords loosely, so the award's own text must contain a term as a whole word.
  const wholeWord = new RegExp(`(^|[^A-Za-z0-9])(${terms.map(escapeForRegExp).join("|")})s?([^A-Za-z0-9]|$)`, "i");
  return (results as RawPriorAward[])
    .filter(
      (raw) =>
        Boolean(raw.generated_internal_id) &&
        wholeWord.test(raw.Description ?? "") &&
        // The search matches on transaction dates, so the award's own start date is checked too:
        // an old award with a recent change is out of range, and a future start is not history yet.
        (raw["Start Date"] ?? "") >= earliest &&
        (raw["Start Date"] ?? "") <= today,
    )
    .slice(0, MAX_PRIOR_AWARDS)
    .map((raw) => {
      const id = raw.generated_internal_id as string;
      return {
        id,
        title: raw.Description as string,
        recipient: raw["Recipient Name"] ?? null,
        amount: typeof raw["Award Amount"] === "number" ? raw["Award Amount"] : null,
        date: raw["Start Date"] ?? null,
        url: `https://www.usaspending.gov/award/${encodeURIComponent(id)}`,
      };
    });
}

export async function findBuyerHistory(records: SourceRecord[]): Promise<Map<string, PriorAward[]>> {
  const notices = records.filter((record) => record.source === "sam");
  const entries = await Promise.all(notices.map(async (record) => [record.id, await findPriorAwards(record)] as const));
  return new Map(entries);
}
