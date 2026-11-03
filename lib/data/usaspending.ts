// USAspending adapter. Request shape from the official contract:
// https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/search/spending_by_award.md
// validated against real responses (keywords shorter than 3 chars return 422, not an empty list).
// Server-side only. Facts come from the response, never from a model.
import type { SourceRecord } from "../types";

export const SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
export const AWARD_URL = "https://api.usaspending.gov/api/v2/awards/";
const TIMEOUT_MS = 15_000;
const MIN_KEYWORD_LENGTH = 3;
const MAX_KEYWORDS = 6;
const MAX_LIMIT = 30;
const TITLE_MAX = 140;
// Contract award types only (definitive contract, purchase order, delivery order, BPA call).
const CONTRACT_TYPE_CODES = ["A", "B", "C", "D"];
const DEFAULT_START_DATE = "2019-10-01";

const FIELDS = [
  "Award ID",
  "Recipient Name",
  "Award Amount",
  "Description",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Start Date",
  "End Date",
  "Contract Award Type",
  "NAICS",
  "PSC",
  "generated_internal_id",
  "Base Obligation Date",
];

export class UsaSpendingError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "UsaSpendingError";
  }
}

export type AwardSearch = {
  keywords: string[];
  naicsCodes?: string[];
  pscCodes?: string[];
  limit?: number;
  startDate?: string;
  endDate?: string;
};

type CodeDescription = { code?: string | null; description?: string | null } | null;

export type RawAward = {
  "Award ID"?: string | null;
  "Recipient Name"?: string | null;
  "Award Amount"?: number | null;
  Description?: string | null;
  "Awarding Agency"?: string | null;
  "Awarding Sub Agency"?: string | null;
  "Start Date"?: string | null;
  "End Date"?: string | null;
  "Contract Award Type"?: string | null;
  NAICS?: CodeDescription;
  PSC?: CodeDescription;
  generated_internal_id?: string | null;
  "Base Obligation Date"?: string | null;
};

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function cleanKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const keyword = raw.trim();
    const key = keyword.toLowerCase();
    if (keyword.length < MIN_KEYWORD_LENGTH || seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out.slice(0, MAX_KEYWORDS);
}

// Returns null when the award has no generated_internal_id: without it there is no source URL to cite.
export function normalizeAward(raw: RawAward, retrievedAt: string): SourceRecord | null {
  const id = raw.generated_internal_id;
  if (!present(id)) return null;

  const excerpts: SourceRecord["excerpts"] = [];
  const addExcerpt = (field: string, value: unknown) => {
    if (present(value)) excerpts.push({ field, text: value });
  };
  addExcerpt("Description", raw.Description);
  addExcerpt("Award ID", raw["Award ID"]);
  addExcerpt("Recipient Name", raw["Recipient Name"]);
  addExcerpt("Contract Award Type", raw["Contract Award Type"]);
  addExcerpt("NAICS.description", raw.NAICS?.description);
  addExcerpt("PSC.description", raw.PSC?.description);
  addExcerpt("Start Date", raw["Start Date"]);
  addExcerpt("End Date", raw["End Date"]);

  const description = present(raw.Description) ? raw.Description : null;
  const title = description
    ? description.length > TITLE_MAX
      ? `${description.slice(0, TITLE_MAX)}...`
      : description
    : present(raw["Award ID"])
      ? `Award ${raw["Award ID"]}`
      : `Award ${id}`;
  const agency =
    [raw["Awarding Agency"], raw["Awarding Sub Agency"]].filter(present).join(" / ") || null;
  const naicsCode = raw.NAICS?.code;

  return {
    id,
    source: "usaspending",
    kind: "historical_award",
    title,
    agency,
    description,
    url: `https://www.usaspending.gov/award/${encodeURIComponent(id)}`,
    retrievedAt,
    postedAt: present(raw["Base Obligation Date"]) ? raw["Base Obligation Date"] : null,
    deadlineAt: null,
    awardAmount: typeof raw["Award Amount"] === "number" ? raw["Award Amount"] : null,
    setAside: null, // not in the search response; see enrichWithAwardDetail
    naics: present(naicsCode) ? naicsCode : null,
    excerpts,
  };
}

async function readJson(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "network error";
    throw new UsaSpendingError(`USAspending request failed: ${reason}`, null);
  }
  if (!response.ok) {
    throw new UsaSpendingError(`USAspending returned HTTP ${response.status}`, response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new UsaSpendingError("USAspending returned invalid JSON", response.status);
  }
}

export async function searchAwards(search: AwardSearch): Promise<SourceRecord[]> {
  const keywords = cleanKeywords(search.keywords);
  if (keywords.length === 0) return [];

  const filters: Record<string, unknown> = {
    keywords,
    award_type_codes: CONTRACT_TYPE_CODES,
    time_period: [
      {
        start_date: search.startDate ?? DEFAULT_START_DATE,
        end_date: search.endDate ?? new Date().toISOString().slice(0, 10),
      },
    ],
  };
  if (search.naicsCodes?.length) filters.naics_codes = search.naicsCodes;
  if (search.pscCodes?.length) filters.psc_codes = search.pscCodes;

  const payload = await readJson(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters,
      fields: FIELDS,
      limit: Math.min(Math.max(search.limit ?? 10, 1), MAX_LIMIT),
      page: 1,
      sort: "Award Amount",
      order: "desc",
      subawards: false,
    }),
  });
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw new UsaSpendingError("USAspending response has no results array", 200);
  }
  const retrievedAt = new Date().toISOString();
  return results
    .map((raw) => normalizeAward(raw as RawAward, retrievedAt))
    .filter((record): record is SourceRecord => record !== null);
}

// Confirms the award exists at the source (404 for unknown ids, unlike the website, which answers 200
// to anything) and adds the verbatim set-aside, which the search response does not carry.
// Returns null when the source does not know the id, or reports a different one.
export async function enrichWithAwardDetail(record: SourceRecord): Promise<SourceRecord | null> {
  let detail: {
    generated_unique_award_id?: string;
    latest_transaction_contract_data?: {
      type_set_aside_description?: string | null;
    } | null;
  };
  try {
    detail = (await readJson(`${AWARD_URL}${encodeURIComponent(record.id)}/`)) as typeof detail;
  } catch (error) {
    if (error instanceof UsaSpendingError && error.status === 404) return null;
    throw error;
  }
  if (detail.generated_unique_award_id !== record.id) return null;

  const setAside = detail.latest_transaction_contract_data?.type_set_aside_description;
  if (!present(setAside)) return record;
  return {
    ...record,
    setAside,
    excerpts: [
      ...record.excerpts,
      { field: "latest_transaction_contract_data.type_set_aside_description", text: setAside },
    ],
  };
}

export function dedupeRecords(records: SourceRecord[]): SourceRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.source}:${record.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
