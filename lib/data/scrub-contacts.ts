// Saved notice text ends up in a public repo. People can reach these contacts through the SAM.gov link,
// so a snapshot doesn't need to republish their names, emails or phone numbers.
export const CONTACT_REMOVED = "[contact removed - see SAM link]";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// A US number with separators. The edges keep it from matching inside stock, part or solicitation numbers.
const PHONE = /(?<![\w.-])(?:\+?1[-. ]?)?(?:\(\d{3}\) ?|\d{3}[-. ])\d{3}[-. ]\d{4}(?: ?(?:x|ext\.?) ?\d{1,6})?(?![\w-])/gi;

export function scrubContacts(text: string): string {
  return text.replace(EMAIL, CONTACT_REMOVED).replace(PHONE, CONTACT_REMOVED);
}

// Drops each sentence holding a removed contact, so "Please contact <name> at ..." goes entirely. Some notices
// are pipe-separated tables with no sentence punctuation, so each field is handled alone: otherwise one contact
// would take thousands of characters of clauses and part numbers with it.
const SENTENCE_END = /(?<!\b(?:Mr|Mrs|Ms|Dr))(?<=[.!?])\s+/;
function dropContactSentences(text: string): string {
  return text
    .split("|")
    .map((field) => {
      const sentences = field.split(SENTENCE_END);
      const kept = sentences.filter((sentence) => !sentence.includes(CONTACT_REMOVED));
      return kept.length === sentences.length ? field : kept.join(" ");
    })
    .join("|")
    .trimEnd();
}

export function scrubDescriptions(descriptions: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(descriptions).map(([id, text]) => [id, dropContactSentences(scrubContacts(text))]));
}
