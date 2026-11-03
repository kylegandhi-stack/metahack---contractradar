// Confirms shortlisted records against their source by id, because source websites can answer 200 to
// any path. A proven mismatch is a BLOCKER. A check that could not run is only a NOTE: a network
// problem says nothing about the record.
import type { AuditFinding, SourceRecord } from "../types";
import { searchNotices } from "./sam";
import { AWARD_URL } from "./usaspending";

const TIMEOUT_MS = 5_000;

const same = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

function mismatch(record: SourceRecord, problem: string): AuditFinding {
  return {
    severity: "BLOCKER",
    issue: `Record identity mismatch: ${problem}`,
    whyItMatters: "Claims about this record cannot be traced to its official source.",
    evidenceSourceId: record.id,
    evidenceExcerpt: null,
    correctiveAction: "Do not use until the record is confirmed at the source.",
  };
}

function notChecked(record: SourceRecord): AuditFinding {
  return {
    severity: "NOTE",
    issue: "Source identity check could not run",
    whyItMatters: "This record was not re-confirmed against its source in this run.",
    evidenceSourceId: record.id,
    evidenceExcerpt: null,
    correctiveAction: "Open the source link and confirm the title and agency.",
  };
}

async function verifyAward(record: SourceRecord): Promise<AuditFinding[]> {
  let response: Response;
  try {
    response = await fetch(`${AWARD_URL}${encodeURIComponent(record.id)}/`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return [notChecked(record)];
  }
  if (response.status === 404) return [mismatch(record, "USAspending does not know this award id")];
  if (!response.ok) return [notChecked(record)];
  let detail: {
    generated_unique_award_id?: string;
    description?: string | null;
    awarding_agency?: { toptier_agency?: { name?: string | null } | null } | null;
  };
  try {
    detail = (await response.json()) as typeof detail;
  } catch {
    return [notChecked(record)];
  }
  const problems: string[] = [];
  if (detail.generated_unique_award_id !== record.id) problems.push("USAspending returned a different award id");
  if (record.description && detail.description && !same(record.description, detail.description)) {
    problems.push("the title does not match USAspending");
  }
  const agency = detail.awarding_agency?.toptier_agency?.name;
  if (record.agency && agency && !record.agency.toLowerCase().includes(agency.toLowerCase())) {
    problems.push(`the agency does not match USAspending (${agency})`);
  }
  return problems.map((problem) => mismatch(record, problem));
}

// The notice came straight from the SAM.gov API in this run or its capture, so the id in its official
// URL is checked without a call. A lookup per notice would spend most of a small daily quota, so it
// only runs when SAM_IDENTITY_LOOKUPS is "on", for a key with a higher quota.
async function verifyNotice(record: SourceRecord): Promise<AuditFinding[]> {
  if (!record.url.includes(record.id)) return [mismatch(record, "the source link does not contain this notice id")];
  if (process.env.SAM_IDENTITY_LOOKUPS !== "on") return [];
  let found: SourceRecord | undefined;
  try {
    found = (await searchNotices({ noticeId: record.id, daysBack: 364, limit: 1 })).find((item) => item.id === record.id);
  } catch {
    return [notChecked(record)];
  }
  if (!found) return [notChecked(record)];
  const problems: string[] = [];
  if (!same(found.title, record.title)) problems.push("the title does not match SAM.gov");
  if (record.agency && found.agency && !same(found.agency, record.agency)) problems.push("the agency does not match SAM.gov");
  return problems.map((problem) => mismatch(record, problem));
}

export async function verifyRecords(records: SourceRecord[]): Promise<Map<string, AuditFinding[]>> {
  const entries = await Promise.all(
    records.map(async (record) => {
      const findings = record.source === "usaspending" ? await verifyAward(record) : await verifyNotice(record);
      return [record.id, findings] as const;
    }),
  );
  return new Map(entries);
}
