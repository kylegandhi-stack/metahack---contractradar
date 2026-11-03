// SAM.gov Get Opportunities adapter. https://open.gsa.gov/api/get-opportunities-public-api/
// Server-side only. The key goes in the query string, so it must never appear in errors or records.
// The search `description` field is a link that needs the key, so text comes from describeNotices.
import type { RelatedNotice, SourceKind, SourceRecord } from "../types";

const SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";
const TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;
const MAX_LIMIT = 25;
const DESCRIPTION_URL = "https://api.sam.gov/prod/opportunities/v1/noticedesc";
const DESCRIPTION_MAX_CHARS = 8_000;
const DESCRIBE_CAP_MS = 8_000;

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
  classificationCode?: string | null;
};

export type NoticeSearch = {
  title?: string;
  naicsCode?: string;
  pscCode?: string;
  noticeId?: string;
  daysBack?: number;
  limit?: number;
};

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
  addExcerpt("classificationCode", raw.classificationCode);
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
    solicitationNumber: present(raw.solicitationNumber) ? raw.solicitationNumber : null,
  };
}

const normalizeKey = (text: string) => text.replace(/\s+/g, " ").trim().toUpperCase();

function noticeGroupKey(record: SourceRecord): string {
  if (present(record.solicitationNumber)) return `number:${normalizeKey(record.solicitationNumber)}`;
  return `title:${normalizeKey(record.title)}|office:${normalizeKey(record.agency ?? "")}`;
}

// Solicitation over presolicitation, then the latest posting.
function moreDecisionRelevant(a: SourceRecord, b: SourceRecord): number {
  const rank = (record: SourceRecord) => (record.kind === "open_notice" ? 0 : 1);
  return rank(a) - rank(b) || (b.postedAt ?? "").localeCompare(a.postedAt ?? "");
}

// Collapses postings of the same buy into one record, listing the rest as related notices. Records
// with different solicitation numbers never merge, even with the same title: a wrong merge could hide
// a real opportunity, which is worse than a duplicate card. Safe to run again on its own output.
export function collapseNotices(records: SourceRecord[]): SourceRecord[] {
  const groups = new Map<string, SourceRecord[]>();
  for (const record of records) {
    if (record.source !== "sam") continue;
    const key = noticeGroupKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const emitted = new Set<string>();
  return records.flatMap((record) => {
    if (record.source !== "sam") return [record];
    const key = noticeGroupKey(record);
    if (emitted.has(key)) return [];
    emitted.add(key);
    const members = groups.get(key) ?? [record];
    if (members.length === 1) return [record];
    const [primary, ...others] = [...members].sort(moreDecisionRelevant);
    const related = new Map<string, RelatedNotice>();
    for (const member of [primary, ...others]) {
      for (const notice of member.relatedNotices ?? []) related.set(notice.id, notice);
    }
    for (const { id, kind, postedAt, url } of others) related.set(id, { id, kind, postedAt, url });
    related.delete(primary.id);
    const relatedNotices = [...related.values()].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
    return [{ ...primary, relatedNotices }];
  });
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
  if (present(search.pscCode)) params.set("ccode", search.pscCode.trim());
  if (present(search.noticeId)) params.set("noticeid", search.noticeId.trim());

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
  // SAM.gov could ignore a filter and return everything, so a PSC search keeps only exact matches.
  const wantedPsc = search.pscCode?.trim().toUpperCase();
  return (payload.opportunitiesData as RawNotice[])
    .filter((raw) => !wantedPsc || raw.classificationCode?.trim().toUpperCase() === wantedPsc)
    .map((raw) => normalizeNotice(raw, retrievedAt))
    .filter((record): record is SourceRecord => record !== null);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// The source text with markup removed, so its wording can still be matched as verbatim evidence.
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:#(\d+)|([a-z]+));/gi, (match, code: string | undefined, name: string | undefined) => {
      if (code) return String.fromCodePoint(Number(code));
      return ENTITIES[(name ?? "").toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchNoticeDescription(noticeId: string, signal: AbortSignal): Promise<string | null> {
  const apiKey = process.env.SAM_API_KEY;
  if (!present(apiKey)) throw new SamError("SAM.gov key is not configured", null);
  const params = new URLSearchParams({ noticeid: noticeId, api_key: apiKey });
  let response: Response;
  try {
    response = await fetch(`${DESCRIPTION_URL}?${params}`, { signal });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "network error";
    throw new SamError(`SAM.gov description request failed: ${reason}`, null);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new SamError(`SAM.gov returned HTTP ${response.status}`, response.status);
  let payload: { description?: unknown };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new SamError("SAM.gov returned invalid JSON", response.status);
  }
  return present(payload.description) ? htmlToText(payload.description) || null : null;
}

// Notice text does not change often and SAM.gov's daily quota is small, so repeat runs reuse it.
const descriptionMemo = new Map<string, string | null>();
export function clearDescriptionMemo() {
  descriptionMemo.clear();
}

export type NoticeDescriptions = {
  texts: Map<string, string>;
  unavailable: string[];
  shortened: string[];
};

// One at a time under one short deadline: the first 429 stops further calls, so a spent quota is not
// hit again, and a slow source cannot push the run past its time target. Never throws.
export async function describeNotices(records: SourceRecord[]): Promise<NoticeDescriptions> {
  const result: NoticeDescriptions = { texts: new Map(), unavailable: [], shortened: [] };
  const signal = AbortSignal.timeout(DESCRIBE_CAP_MS);
  let stopped = false;
  for (const record of records) {
    let text: string | null | undefined = descriptionMemo.get(record.id);
    if (text === undefined && !stopped) {
      try {
        text = await fetchNoticeDescription(record.id, signal);
        descriptionMemo.set(record.id, text);
      } catch (error) {
        if (error instanceof SamError && (error.status === 429 || signal.aborted)) stopped = true;
      }
    }
    if (!text) {
      result.unavailable.push(record.id);
    } else if (text.length > DESCRIPTION_MAX_CHARS) {
      result.texts.set(record.id, text.slice(0, DESCRIPTION_MAX_CHARS));
      result.shortened.push(record.id);
    } else {
      result.texts.set(record.id, text);
    }
  }
  return result;
}
