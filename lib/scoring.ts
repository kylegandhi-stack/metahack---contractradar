// Relevance score, not a win probability. Unknown components stay null and add nothing to the total,
// so missing information can only lower a score.
import type { CompanyProfile, Confidence, FitBreakdown, FitSignal, ReviewStatus, SourceKind, SourceRecord } from "./types";

const LIMITS = { technical: 40, category: 20, eligibility: 20, execution: 10, timing: 10 } as const;
const ORDER: Confidence[] = ["low", "medium", "high"];

function clamp(value: number | null | undefined, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(Math.max(Math.round(value), 0), max);
}

export function computeFit(
  raw: Partial<Record<keyof FitBreakdown, number | null>>,
  kind: SourceKind,
): { fitBreakdown: FitBreakdown; fitScore: number } {
  const historical = kind === "historical_award";
  const fitBreakdown: FitBreakdown = {
    technical: clamp(raw.technical, LIMITS.technical),
    category: clamp(raw.category, LIMITS.category),
    // A past award supports no eligibility or timing claim, whatever the model returned.
    eligibility: historical ? null : clamp(raw.eligibility, LIMITS.eligibility),
    execution: clamp(raw.execution, LIMITS.execution),
    timing: historical ? null : clamp(raw.timing, LIMITS.timing),
  };
  const fitScore = Object.values(fitBreakdown).reduce<number>((sum, part) => sum + (part ?? 0), 0);
  return { fitBreakdown, fitScore };
}

export function finalConfidence(modelConfidence: Confidence, status: ReviewStatus): Confidence {
  const ceiling: Confidence = status === "HOLD" ? "low" : status === "REVIEW_REQUIRED" ? "medium" : "high";
  return ORDER[Math.min(ORDER.indexOf(modelConfidence), ORDER.indexOf(ceiling))];
}

// Deterministic relevance signals. They replace the model's opinion on category, and on execution
// when an award amount gives something to measure. Same inputs, same score.
const PRODUCT_POINTS = { titleLead: 8, title: 6, description: 4, word: 2 } as const;
const AGENCY_POINTS = 7;
const RECENCY_POINTS = 5;
const YEAR_MS = 365.25 * 86_400_000;
// A rough yearly capacity per employee, used only to compare award sizes. An estimate, not a fact.
const CAPACITY_PER_EMPLOYEE_USD = 250_000;
const EXACT_PRODUCT_MIN = 34;
const UNCITED_TECHNICAL_CAP = 19;
// Below this, a record isn't really the company's product, so buyer, date and size can't lift it.
const WEAK_TECHNICAL = 20;

const escapeForRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
// Accepts singular and plural either way, since the Planner may choose either form.
function singular(term: string): string {
  if (/ies$/i.test(term)) return `${term.slice(0, -3)}y`;
  if (/(ch|sh|x|ss)es$/i.test(term)) return term.slice(0, -2);
  return /[^s]s$/i.test(term) ? term.slice(0, -1) : term;
}
function hasTerm(text: string, term: string): boolean {
  const base = singular(term.trim());
  const stem = /y$/i.test(base) ? `${base.slice(0, -1)}(?:y|ies)` : `${escapeForRegExp(base)}(?:s|es)?`;
  return new RegExp(`(^|[^a-z0-9])${stem}([^a-z0-9]|$)`, "i").test(text);
}

export function productSignal(record: SourceRecord, terms: string[]): FitSignal {
  const title = record.title;
  const description = record.description ?? "";
  const signal = (points: number, detail: string): FitSignal => ({ signal: "product_term", points, max: PRODUCT_POINTS.titleLead, detail });
  // The Planner lists its most specific terms first, so the first two count most.
  const inTitle = terms.findIndex((term) => hasTerm(title, term));
  if (inTitle >= 0) {
    return signal(inTitle < 2 ? PRODUCT_POINTS.titleLead : PRODUCT_POINTS.title, `"${terms[inTitle]}" in the title`);
  }
  const inDescription = terms.find((term) => hasTerm(description, term));
  if (inDescription) return signal(PRODUCT_POINTS.description, `"${inDescription}" in the description`);
  const word = terms
    .flatMap((term) => term.split(/\s+/))
    .find((part) => part.length >= 4 && hasTerm(`${title} ${description}`, part));
  return word ? signal(PRODUCT_POINTS.word, `Only the word "${word}" matches`) : signal(0, "No search term in the record");
}

const normalizeAgency = (text: string) => text.toUpperCase().replace(/\bDEPT\b/g, "DEPARTMENT").replace(/\s+/g, " ");

// Null when the profile names no agencies, so those points aren't available.
export function agencySignal(record: SourceRecord, profile: CompanyProfile): FitSignal | null {
  const targets = profile.targetAgencies ?? [];
  if (targets.length === 0) return null;
  const agency = normalizeAgency(record.agency ?? "");
  const match = targets.find((target) => agency.includes(normalizeAgency(target)));
  return {
    signal: "target_agency",
    points: match ? AGENCY_POINTS : 0,
    max: AGENCY_POINTS,
    detail: match ? `Matches target agency ${match}` : "Not one of the target agencies",
  };
}

export function recencySignal(record: SourceRecord, now: number): FitSignal {
  const raw = record.postedAt ?? record.excerpts.find((excerpt) => excerpt.field === "Start Date")?.text;
  const at = raw ? Date.parse(raw) : Number.NaN;
  const signal = (points: number, detail: string): FitSignal => ({ signal: "recency", points, max: RECENCY_POINTS, detail });
  if (Number.isNaN(at)) return signal(0, "No date in the record");
  const years = (now - at) / YEAR_MS;
  const label = `Dated ${raw}`;
  if (years <= 2) return signal(5, label);
  if (years <= 4) return signal(3, label);
  return years <= 6 ? signal(1, label) : signal(0, label);
}

export function companySize(profile: CompanyProfile): number | null {
  const match = profile.capabilities.match(/(\d[\d,]*)[\s-]*(?:person|people|employees?)\b/i);
  const size = match ? Number(match[1].replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(size) && size > 0 ? size : null;
}

// Null without both numbers: a notice has no amount, and a profile may not state a size.
export function awardSizeSignal(record: SourceRecord, profile: CompanyProfile): FitSignal | null {
  const size = companySize(profile);
  const amount = record.awardAmount;
  if (size === null || amount == null || amount <= 0) return null;
  const capacity = size * CAPACITY_PER_EMPLOYEE_USD;
  const signal = (points: number, band: string): FitSignal => ({
    signal: "award_size",
    points,
    max: 10,
    detail: `Estimate: \$${Math.round(amount).toLocaleString("en-US")} is ${band} for ${size} people`,
  });
  if (amount <= capacity) return signal(10, "a comfortable size");
  if (amount <= capacity * 3) return signal(7, "a stretch");
  return amount <= capacity * 10 ? signal(4, "a large stretch") : signal(1, "far too large");
}

export type ScoreInput = {
  record: SourceRecord;
  profile: CompanyProfile;
  terms: string[];
  assessment: Partial<Record<"technical" | "eligibility" | "execution" | "timing", number | null>> & {
    technicalExcerpt?: string | null;
  };
  now: number;
};

export function scoreRecord({ record, profile, terms, assessment, now }: ScoreInput) {
  const product = productSignal(record, terms);
  const agency = agencySignal(record, profile);
  const recency = recencySignal(record, now);
  const size = awardSizeSignal(record, profile);
  const fitSignals = [product, ...(agency ? [agency] : []), recency, ...(size ? [size] : [])];

  // The rubric's top band means the exact product, so the record must actually name a term. A score
  // with no verbatim excerpt behind it can't claim more than an unconfirmed match.
  let technical = assessment.technical ?? null;
  if (technical !== null && !assessment.technicalExcerpt) technical = Math.min(technical, UNCITED_TECHNICAL_CAP);
  const exactNamed = product.points >= PRODUCT_POINTS.description;
  if (technical !== null && !exactNamed) technical = Math.min(technical, EXACT_PRODUCT_MIN - 1);

  const support = (points: number | null | undefined) =>
    points != null && technical !== null && technical < WEAK_TECHNICAL
      ? Math.min(points, Math.floor(technical / 4))
      : points;
  const { fitBreakdown, fitScore } = computeFit(
    {
      technical,
      category: support(product.points + (agency?.points ?? 0) + recency.points),
      eligibility: assessment.eligibility,
      execution: support(size?.points ?? assessment.execution),
      timing: assessment.timing,
    },
    record.kind,
  );
  // Points never move up to fill a smaller scale. A past award has no eligibility or timing to earn.
  const historical = record.kind === "historical_award";
  const fitMax = LIMITS.technical + (LIMITS.category - (agency ? 0 : AGENCY_POINTS)) + LIMITS.execution +
    (historical ? 0 : LIMITS.eligibility + LIMITS.timing);
  return { fitBreakdown, fitScore, fitMax, fitSignals };
}

type Rankable = {
  fitScore: number;
  fitBreakdown?: FitBreakdown;
  record: Pick<SourceRecord, "id" | "postedAt">;
};

// A total order, so equal scores can't swap between runs: score, technical fit, category, newest, id.
export function compareByFit(a: Rankable, b: Rankable): number {
  return (
    b.fitScore - a.fitScore ||
    (b.fitBreakdown?.technical ?? -1) - (a.fitBreakdown?.technical ?? -1) ||
    (b.fitBreakdown?.category ?? -1) - (a.fitBreakdown?.category ?? -1) ||
    (b.record.postedAt ?? "").localeCompare(a.record.postedAt ?? "") ||
    a.record.id.localeCompare(b.record.id)
  );
}
