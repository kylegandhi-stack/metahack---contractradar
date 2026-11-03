// Fallback records saved from real API responses by scripts/fetch-verified-records.mjs.
import verified from "../../data/verified-records.json";
import { VerifiedRecordsSchema } from "../schemas";
import type { SourceRecord } from "../types";

export type CachedRecords = { records: SourceRecord[]; retrievedAt: string };

export function loadVerifiedRecords(): CachedRecords | null {
  const parsed = VerifiedRecordsSchema.safeParse(verified);
  if (!parsed.success) return null;
  return { records: parsed.data.records, retrievedAt: parsed.data.retrievedAt };
}
