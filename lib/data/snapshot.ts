// Real SAM.gov notices saved by scripts/fetch-sam-snapshot.mts for demo profiles. SAM.gov's daily quota
// is small, so production falls back to these on a 429 or a missing key, labeled as cached.
import snapshot from "../../data/sam-snapshot.json";
import { SamSnapshotSchema } from "../schemas";
import type { SourceRecord } from "../types";

export type ProfileSnapshot = {
  retrievedAt: string;
  records: SourceRecord[];
  descriptions: Record<string, string>;
  shortened: string[];
};

export function loadSamSnapshot(profileName: string): ProfileSnapshot | null {
  const parsed = SamSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) return null;
  const saved = parsed.data.profiles[profileName];
  return saved && saved.records.length > 0 ? saved : null;
}
