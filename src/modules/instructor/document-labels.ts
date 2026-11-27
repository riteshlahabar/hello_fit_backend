// How a document type is spelled for a person — client, 27-11-2026: the
// admin panel's trainer view was printing the enum, "Awaiting verification:
// ID_PROOF, PAN, BANK_DETAILS".
//
// It lives on the backend because the gate reasons in `onboarding.ts` are
// built here and shown verbatim on three surfaces (admin panel, trainer app,
// customer-facing nothing) — formatting them once at the source keeps the
// three from each inventing their own spelling.
//
// A table, not a `replace(/_/g, ' ')`: an initialism must stay upper case
// ("PAN", not "Pan") and "ID proof" is not what title-casing produces.

/** Enum spelling → the words a reviewer reads. */
const DOCUMENT_LABELS: Record<string, string> = {
  ID_PROOF: 'ID proof',
  ADDRESS_PROOF: 'Address proof',
  PAN: 'PAN',
  BANK_DETAILS: 'Bank details',
  YOGA_CERTIFICATION: 'Yoga certification',
  POLICE_VERIFICATION: 'Police verification',
  PHOTO: 'Photo',
  OTHER: 'Other',
};

/**
 * The label for one document type. An unlisted value — a new enum member that
 * reached here before this table did — falls back to its words in lower case
 * rather than the raw enum, so a reason line never shows an underscore.
 */
export function documentLabel(docType: string): string {
  const known = DOCUMENT_LABELS[docType];
  if (known) return known;

  const words = docType.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The same, for a list in a sentence: "ID proof, PAN, Bank details". */
export function documentLabels(docTypes: string[]): string {
  return docTypes.map(documentLabel).join(', ');
}
