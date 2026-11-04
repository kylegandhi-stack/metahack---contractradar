// Saved notice text ends up in a public repo. People can reach these contacts through the SAM.gov link,
// so a snapshot doesn't need to republish their emails and phone numbers.
export const CONTACT_REMOVED = "[contact removed - see SAM link]";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// A US number with separators. The edges keep it from matching inside stock, part or solicitation numbers.
const PHONE = /(?<![\w.-])(?:\+?1[-. ]?)?(?:\(\d{3}\) ?|\d{3}[-. ])\d{3}[-. ]\d{4}(?: ?(?:x|ext\.?) ?\d{1,6})?(?![\w-])/gi;

export function scrubContacts(text: string): string {
  return text.replace(EMAIL, CONTACT_REMOVED).replace(PHONE, CONTACT_REMOVED);
}

export function scrubDescriptions(descriptions: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(descriptions).map(([id, text]) => [id, scrubContacts(text)]));
}
