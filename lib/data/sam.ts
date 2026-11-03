// SAM.gov Get Opportunities adapter. https://open.gsa.gov/api/get-opportunities-public-api/
// Server-side only. The key goes in the query string, so it must never appear in errors or records.
// The `description` field is a link that needs the key, not text, so it is deliberately not stored.
import type { SourceKind, SourceRecord } from "../types";

const SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";
const TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;
const MAX_LIMIT = 25;

export class SamError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SamError";
  }
}

export type RawNotice = {
  noticeId?: string | null;
  title?: string | null;
  solicitationNumber?: string | null;
  fullParentPathName?: string | null;
  postedDate?: string | null;
  type?: string | null;
  responseDeadLine?: string | null;
  naicsCode?: string | null;
  typeOfSetAside?: string | null;
  typeOfSetAsideDescription?: string | null;
  active?: string | null;
  uiLink?: string | null;
};

export type NoticeSearch = { title?: string; naicsCode?: string; daysBack?: number; limit?: number };

const KIND_BY_TYPE: Record<string, SourceKind> = {
  solicitation: "open_notice",
  "combined synopsis/solicitation": "open_notice",
  "sources sought": "early_stage_notice",
  presolicitation: "early_stage_notice",
};

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isSamConfigured(): boolean {
  return present(process.env.SAM_API_KEY);
}

// Uses `type` and not `baseType`, which keeps the original notice type after an award notice is posted.
export function classifyNotice(type: string | null | undefined): SourceKind | null {
  return KIND_BY_TYPE[(type ?? "").trim().toLowerCase()] ?? null;
}

function officialSamUrl(value: unknown): value is string {
  if (!present(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "sam.gov";
  } catch {
    return false;
  }
}

// Expired notices are kept on purpose: SAM can report active "Yes" after the deadline, and the
// deterministic gate in lib/review.ts turns those into a visible HOLD.
export function normalizeNotice(raw: RawNotice, retrievedAt: string): SourceRecord | null {
  const kind = classifyNotice(raw.type);
  if (!kind || raw.active !== "Yes") return null;
  if (!present(raw.noticeId) || !present(raw.title) || !officialSamUrl(raw.uiLink)) return null;

  const setAside = present(raw.typeOfSetAsideDescription)
    ? raw.typeOfSetAsideDescription
    : present(raw.typeOfSetAside)
      ? raw.typeOfSetAside
      : null;

  const excerpts: SourceRecord["excerpts"] = [];
  const addExcerpt = (field: string, value: unknown) => {
    if (present(value)) excerpts.push({ field, text: value });
  };
  addExcerpt("title", raw.title);
  addExcerpt("type", raw.type);
  addExcerpt("solicitationNumber", raw.solicitationNumber);
  addExcerpt("responseDeadLine", raw.responseDeadLine);
  addExcerpt("typeOfSetAsideDescription", raw.typeOfSetAsideDescription);
  addExcerpt("typeOfSetAside", raw.typeOfSetAside);
  addExcerpt("naicsCode", raw.naicsCode);
  addExcerpt("fullParentPathName", raw.fullParentPathName);

  return {
    id: raw.noticeId,
    source: "sam",
    kind,
    title: raw.title,
    agency: present(raw.fullParentPathName) ? raw.fullParentPathName : null,
    description: null,
    url: raw.uiLink,
    retrievedAt,
    postedAt: present(raw.postedDate) ? raw.postedDate : null,
    deadlineAt: present(raw.responseDeadLine) ? raw.responseDeadLine : null,
    awardAmount: null,
    setAside,
    naics: present(raw.naicsCode) ? raw.naicsCode : null,
    excerpts,
  };
}

function samDate(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${date.getUTCFullYear()}`;
}

export async function searchNotices(search: NoticeSearch): Promise<SourceRecord[]> {
  const apiKey = process.env.SAM_API_KEY;
  if (!present(apiKey)) throw new SamError("SAM.gov key is not configured", null);

  const now = Date.now();
  const params = new URLSearchParams({
    api_key: apiKey,
    postedFrom: samDate(new Date(now - (search.daysBack ?? 90) * DAY_MS)),
    postedTo: samDate(new Date(now)),
    limit: String(Math.min(Math.max(search.limit ?? 10, 1), MAX_LIMIT)),
    offset: "0",
  });
  if (present(search.title)) params.set("title", search.title.trim());
  if (present(search.naicsCode)) params.set("ncode", search.naicsCode.trim());

  let response: Response;
  try {
    response = await fetch(`${SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "network error";
    throw new SamError(`SAM.gov request failed: ${reason}`, null);
  }
  if (!response.ok) throw new SamError(`SAM.gov returned HTTP ${response.status}`, response.status);

  let payload: { opportunitiesData?: unknown };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new SamError("SAM.gov returned invalid JSON", response.status);
  }
  if (!Array.isArray(payload.opportunitiesData)) return [];
  const retrievedAt = new Date().toISOString();
  return payload.opportunitiesData
    .map((raw) => normalizeNotice(raw as RawNotice, retrievedAt))
    .filter((record): record is SourceRecord => record !== null);
}
