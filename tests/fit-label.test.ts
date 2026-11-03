import assert from "node:assert/strict";
import { test } from "node:test";
import { fitLabel, isStrongHistorical } from "../components/format";
import type { RankedResult } from "../lib/types";

const result = (kind: string, fitScore: number, fitMax?: number) => ({ record: { kind }, fitScore, fitMax, findings: [] }) as unknown as RankedResult;
const award = (score: number, max?: number) => result("historical_award", score, max);

test("a past award reads as strong from 90% of its available points", () => {
  assert.equal(fitLabel(award(65, 70)), "Strong historical match"); // best score a real run has reached
  assert.equal(fitLabel(award(63, 70)), "Strong historical match");
  assert.equal(fitLabel(award(70, 70)), "Strong historical match");
  assert.equal(fitLabel(award(62, 70)), "Hist. relevance");
});

test("the threshold follows fitMax for profiles with no target agency", () => {
  assert.equal(fitLabel(award(57, 63)), "Strong historical match");
  assert.equal(fitLabel(award(56, 63)), "Hist. relevance");
});

test("a missing fitMax counts as 100, so an old 70 isn't strong", () => {
  assert.equal(fitLabel(award(70)), "Hist. relevance");
});

test("a notice never gets the historical label", () => {
  const notice = result("open_notice", 100, 100);
  assert.equal(fitLabel(notice), "Fit score");
  assert.equal(isStrongHistorical(notice), false);
});
