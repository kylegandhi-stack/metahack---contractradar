import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONTACT_REMOVED, scrubContacts, scrubDescriptions } from "../lib/data/scrub-contacts";

const R = CONTACT_REMOVED;

test("emails and phone numbers are replaced", () => {
  assert.equal(scrubContacts("Email jane.q.doe.civ@us.navy.mil."), `Email ${R}.`);
  assert.equal(scrubContacts("A|555-010-4477|b@example.gov| ITEM"), `A|${R}|${R}| ITEM`);
  for (const phone of ["(555) 010-4477", "555.010.4477", "555 010 4477", "+1 555-010-4477", "1-555-010-4477", "555-010-4477 ext. 12"]) {
    assert.equal(scrubContacts(`Call ${phone} today`), `Call ${R} today`, phone);
  }
});

test("procurement numbers are left alone", () => {
  const kept = "NSN 5845-01-123-4567, N66604-26-R-0483, 52.211-14, 8192622-503, 53711-8482297, S9320-AM-PRO-020, 2026-O0040, N744.17, Nov 30 2026";
  assert.equal(scrubContacts(kept), kept);
});

const one = (text: string) => scrubDescriptions({ id: text }).id;

test("a sentence holding a contact goes entirely, including the name", () => {
  assert.equal(one("Scope is hydrophones. Please contact Jane Doe at jd@example.gov and Sam Roe at 555-010-4477 with questions. See Section L."), "Scope is hydrophones. See Section L.");
  assert.equal(one("Scope is hydrophones. Contact Mr. John Doe at jd@example.gov."), "Scope is hydrophones.");
});

test("in a table, only the field holding the contact goes", () => {
  assert.equal(one("CONTACT INFORMATION|4|N744.17|555-010-4477|jd@example.gov| ITEM IDENTIFICATION (JAN 2023)|19|See Section C.| INSPECTION (AUG 1996)|2"), "CONTACT INFORMATION|4|N744.17||| ITEM IDENTIFICATION (JAN 2023)|19|See Section C.| INSPECTION (AUG 1996)|2");
});

test("scrubbing is safe to repeat, leaves other text alone and keeps every record id", () => {
  const once = scrubDescriptions({ a: "Write to x@y.mil", b: "No contact here.  Spacing stays." });
  assert.deepEqual(once, { a: "", b: "No contact here.  Spacing stays." });
  assert.deepEqual(scrubDescriptions(once), once);
});

test("the saved snapshot has no contact details in its descriptions", () => {
  const file = JSON.parse(readFileSync(new URL("../data/sam-snapshot.json", import.meta.url), "utf8"));
  for (const profile of Object.values<{ descriptions: Record<string, string> }>(file.profiles)) {
    for (const text of Object.values(profile.descriptions)) {
      assert.equal(scrubContacts(text), text);
      assert.equal(text.includes(CONTACT_REMOVED), false);
    }
  }
});
