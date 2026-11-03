// Deterministic gates. The model writes findings; this code decides the final status.
import type { AuditFinding, Eligibility, CompanyProfile, ReviewStatus, SourceRecord } from "./types";

const TIGHT_DEADLINE_MS = 3 * 86_400_000;
const LOW_TECHNICAL = 12;

export type RawCriticFinding = {
  severity: "BLOCKER" | "WARNING" | "NOTE";
  issue: string;
  why_it_matters: string;
  evidence_source_id: string | null;
  exact_supporting_excerpt: string | null;
  proposed_correction: string;
};

const NEEDS_VERIFICATION = "Needs verification. ";

const collapse = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

export function isVerbatim(excerpt: string | null | undefined, record: SourceRecord): boolean {
  if (!excerpt || excerpt.trim().length < 3) return false;
  const needle = collapse(excerpt);
  const fields = [
    record.title,
    record.description,
    record.agency,
    record.setAside,
    record.naics,
    record.deadlineAt,
    record.postedAt,
    ...record.excerpts.map((entry) => entry.text),
  ];
  return fields.some((field) => field != null && collapse(field).includes(needle));
}

export function statusFromFindings(findings: AuditFinding[]): ReviewStatus {
  if (findings.some((finding) => finding.severity === "BLOCKER")) return "HOLD";
  if (findings.some((finding) => finding.severity === "WARNING")) return "REVIEW_REQUIRED";
  return "APPROVED";
}

// A model BLOCKER only stands with the right source id and text that really is in the record.
// Otherwise it becomes a WARNING, and text that is not in the record is never shown as evidence.
export function verifyCriticFinding(raw: RawCriticFinding, record: SourceRecord): AuditFinding {
  const sameSource = raw.evidence_source_id === record.id;
  const verbatim = sameSource && isVerbatim(raw.exact_supporting_excerpt, record);
  const downgraded = raw.severity === "BLOCKER" && !verbatim;
  return {
    severity: downgraded ? "WARNING" : raw.severity,
    issue: raw.issue,
    whyItMatters: raw.why_it_matters,
    evidenceSourceId: sameSource ? record.id : null,
    evidenceExcerpt: verbatim ? raw.exact_supporting_excerpt : null,
    correctiveAction: downgraded ? `${NEEDS_VERIFICATION}${raw.proposed_correction}` : raw.proposed_correction,
  };
}

const NO_SET_ASIDE = /^(none|no set.?aside.*|n\/a)$/i;
const CERT_PATTERNS: { label: string; setAside: RegExp; certification: RegExp }[] = [
  { label: "8(a)", setAside: /\b8\s*\(?a\)?/i, certification: /\b8\s*\(?a\)?/i },
  { label: "HUBZone", setAside: /hubzone/i, certification: /hubzone/i },
  {
    label: "SDVOSB",
    setAside: /service.?disabled|sdvosb/i,
    certification: /service.?disabled|sdvosb/i,
  },
  { label: "WOSB", setAside: /wom[ae]n.?owned|wosb/i, certification: /wom[ae]n.?owned|wosb/i },
  { label: "VOSB", setAside: /veteran.?owned|vosb/i, certification: /veteran.?owned|vosb/i },
];

export type GateResult = { findings: AuditFinding[]; eligibility: Eligibility };

function setAsideGate(record: SourceRecord, profile: CompanyProfile): GateResult {
  const setAside = record.setAside?.trim();
  // An empty field says nothing, so only an explicit "no set-aside" from the source counts as met.
  if (!setAside) return { findings: [], eligibility: "needs_verification" };
  if (NO_SET_ASIDE.test(setAside)) return { findings: [], eligibility: "meets_known_requirements" };
  const base = { evidenceSourceId: record.id, evidenceExcerpt: setAside };
  const smallOnly = /small|8\s*\(?a\)?|hubzone|sdvosb|wosb|vosb|veteran|wom[ae]n/i.test(setAside);

  if (smallOnly && profile.smallBusiness === false) {
    return {
      eligibility: "known_blocker",
      findings: [
        {
          ...base,
          severity: "BLOCKER",
          issue: `Set-aside conflicts with the company profile: ${setAside}`,
          whyItMatters: "The profile says the company is not a small business.",
          correctiveAction: "Do not pursue as presented; consider teaming with an eligible prime.",
        },
      ],
    };
  }
  const required = CERT_PATTERNS.find((pattern) => pattern.setAside.test(setAside));
  if (required) {
    const held = (profile.certifications ?? []).some((cert) => required.certification.test(cert));
    if (held) return { findings: [], eligibility: "needs_verification" };
    return {
      eligibility: "needs_verification",
      findings: [
        {
          ...base,
          severity: "WARNING",
          issue: `Set-aside requires ${required.label}, which the profile does not list: ${setAside}`,
          whyItMatters: "A missing certification is unknown, not proof that the company is ineligible.",
          correctiveAction: "Needs verification: confirm certification status before pursuing.",
        },
      ],
    };
  }
  if (smallOnly && profile.smallBusiness === true) {
    return { findings: [], eligibility: "meets_known_requirements" };
  }
  return {
    eligibility: "needs_verification",
    findings: [
      {
        ...base,
        severity: "WARNING",
        issue: `Set-aside eligibility could not be confirmed: ${setAside}`,
        whyItMatters: "The profile does not establish whether the company qualifies.",
        correctiveAction: "Needs verification: confirm size status against the set-aside.",
      },
    ],
  };
}

function deadlineGate(record: SourceRecord, now: number): AuditFinding[] {
  const excerpt = record.deadlineAt ?? null;
  const parsed = excerpt ? Date.parse(excerpt) : Number.NaN;
  if (Number.isNaN(parsed)) {
    if (record.kind !== "open_notice") return [];
    return [
      {
        severity: "WARNING",
        issue: excerpt ? `Response deadline is ambiguous: ${excerpt}` : "No response deadline in the source",
        whyItMatters: "The notice cannot be confirmed as open without a clear deadline.",
        evidenceSourceId: excerpt ? record.id : null,
        evidenceExcerpt: excerpt,
        correctiveAction: "Needs verification: confirm the deadline on the source record.",
      },
    ];
  }
  if (parsed <= now) {
    return [
      {
        severity: "BLOCKER",
        issue: `Response deadline has passed: ${excerpt}`,
        whyItMatters: "The source can still report the notice as active after the response date.",
        evidenceSourceId: record.id,
        evidenceExcerpt: excerpt,
        correctiveAction: "Do not pursue as presented; check the source for an extension or follow-on.",
      },
    ];
  }
  if (parsed - now < TIGHT_DEADLINE_MS) {
    return [
      {
        severity: "WARNING",
        issue: `Response deadline is within 3 days: ${excerpt}`,
        whyItMatters: "There may not be enough time to prepare a compliant response.",
        evidenceSourceId: record.id,
        evidenceExcerpt: excerpt,
        correctiveAction: "Decide on pursuit immediately and confirm the date on the source.",
      },
    ];
  }
  return [];
}

function identityGate(record: SourceRecord): AuditFinding[] {
  const problems: string[] = [];
  let host = "";
  try {
    host = new URL(record.url).hostname;
  } catch {
    problems.push("source URL is not valid");
  }
  if (!record.id.trim()) problems.push("source id is missing");
  const expectedHost = record.source === "sam" ? "sam.gov" : "www.usaspending.gov";
  if (host && host !== expectedHost) problems.push(`source URL host ${host} does not match ${record.source}`);
  if (record.kind === "historical_award") {
    if (record.source !== "usaspending") problems.push("historical award not from USAspending");
    if (record.deadlineAt != null) problems.push("historical award carries a response deadline");
  } else if (record.source !== "sam") {
    problems.push("notice not from SAM.gov");
  }
  if (record.excerpts.length === 0) problems.push("record has no source excerpts");
  return problems.map((problem) => ({
    severity: "BLOCKER" as const,
    issue: `Record identity problem: ${problem}`,
    whyItMatters: "Claims about this record cannot be traced to its official source.",
    evidenceSourceId: null,
    evidenceExcerpt: null,
    correctiveAction: "Do not use until the record is confirmed at the source.",
  }));
}

// Checks needing no model. Runs on every result, reviewed by the critic or not.
export function applyGates(
  record: SourceRecord,
  profile: CompanyProfile,
  technical: number | null,
  now: number,
): GateResult {
  const findings = [...identityGate(record), ...deadlineGate(record, now)];
  let eligibility: Eligibility = "needs_verification";
  if (record.kind === "historical_award") {
    findings.push({
      severity: "NOTE",
      issue: "Historical award, not an open opportunity",
      whyItMatters: "Useful for buyer discovery; the amount is a past obligation, not available budget.",
      evidenceSourceId: record.id,
      evidenceExcerpt: null,
      correctiveAction: "Look for current notices from this buyer before planning a bid.",
    });
  } else {
    const gate = setAsideGate(record, profile);
    findings.push(...gate.findings);
    eligibility = gate.eligibility;
  }
  if (technical !== null && technical < LOW_TECHNICAL) {
    findings.push({
      severity: "WARNING",
      issue: "Low technical match to the company's stated capabilities",
      whyItMatters: "A shared keyword does not establish that the actual scope fits.",
      evidenceSourceId: record.id,
      evidenceExcerpt: null,
      correctiveAction: "Needs verification: read the source scope before spending time on this.",
    });
  }
  return { findings, eligibility };
}

// The gate and the critic often cite the same text. The gate's finding comes first and is kept.
export function dedupeFindings(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (!finding.evidenceExcerpt) return true;
    const key = `${finding.severity}:${finding.evidenceExcerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const MAX_WARNINGS_PER_RESULT = 2;

// Keeps a result to the warning limit by demoting the critic's excess WARNINGs to NOTEs. Nothing is
// deleted, BLOCKERs are untouched, and warnings from code are never demoted because they are checked
// facts, so three gate warnings can still exceed the limit. A warning always survives if one existed,
// so this can't change reviewStatus.
export function capCriticWarnings(
  findings: AuditFinding[],
  critic: ReadonlySet<AuditFinding>,
  max = MAX_WARNINGS_PER_RESULT,
): AuditFinding[] {
  const isCriticWarning = (finding: AuditFinding) => finding.severity === "WARNING" && critic.has(finding);
  const fixed = findings.filter((finding) => finding.severity === "WARNING" && !critic.has(finding)).length;
  // Claimed contradictions we could not verify come first, then warnings with verified excerpts.
  const priority = (finding: AuditFinding) =>
    finding.correctiveAction?.startsWith(NEEDS_VERIFICATION) ? 0 : finding.evidenceExcerpt ? 1 : 2;
  const kept = new Set(
    findings
      .filter(isCriticWarning)
      .sort((a, b) => priority(a) - priority(b))
      .slice(0, Math.max(0, max - fixed)),
  );
  return findings.map((finding) =>
    isCriticWarning(finding) && !kept.has(finding) ? { ...finding, severity: "NOTE" as const } : finding,
  );
}

const RANK = { BLOCKER: 0, WARNING: 1, NOTE: 2 } as const;
export function sortFindings(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
