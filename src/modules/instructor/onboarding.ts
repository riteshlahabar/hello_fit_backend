import type { OnboardingPolicy } from '../settings/settings.defaults';
import type {
  DocumentType,
  KycStatus,
  OnboardingStage,
  VerifyStatus,
} from '../../generated/prisma/enums';

/**
 * The teacher onboarding pipeline (spec 3.6), as pure functions.
 *
 * No DB and no HTTP, because this is the part ops will argue about: "why can't
 * this applicant be approved?" has to be answerable from the profile and the
 * document list alone, and reproducibly. Every decision here reads the policy
 * passed in — which documents are required, which must be verified, whether a
 * demo is part of the pipeline — because section 12 of the spec leaves the
 * empanelled-vs-salaried question open and that changes the required set.
 */

/** The happy path, in order. `REJECTED` is reachable from anywhere. */
export const STAGE_SEQUENCE: OnboardingStage[] = [
  'APPLIED',
  'DOCUMENTS_SUBMITTED',
  'SCREENING_CALL',
  'DEMO_SESSION',
  'APPROVED',
];

export interface DocumentLike {
  docType: DocumentType;
  verifyStatus: VerifyStatus;
  expiryDate?: Date | null;
}

/** The subset of InstructorProfile the pipeline cares about. */
export interface ApplicantLike {
  name: string;
  bio?: string | null;
  experienceYears: number;
  languages: string[];
  specialisations: string[];
  homeBaseLat?: unknown;
  homeBaseLng?: unknown;
  codeOfConductAt?: Date | null;
}

export interface Gate {
  ok: boolean;
  /** Human-readable, ordered, and safe to show the applicant. */
  reasons: string[];
}

// ------------------------------------------------------------------ documents

/**
 * Required document types with nothing uploaded yet. A `REJECTED` upload counts
 * as missing — the applicant has to replace it — while `PENDING` counts as
 * present, because submitting for review is what triggers the check.
 */
export function missingDocuments(
  policy: OnboardingPolicy,
  documents: DocumentLike[],
): string[] {
  const usable = new Set(
    documents
      .filter((d) => d.verifyStatus !== 'REJECTED')
      .map((d) => String(d.docType)),
  );
  return policy.requiredDocuments.filter((type) => !usable.has(type));
}

/**
 * Required-and-must-be-verified document types not yet `VERIFIED`. This is the
 * approval gate, separate from the submission gate: a photo may be missing a
 * reviewer's tick without blocking the hire, a police verification may not.
 */
export function unverifiedDocuments(
  policy: OnboardingPolicy,
  documents: DocumentLike[],
): string[] {
  const verified = new Set(
    documents
      .filter((d) => d.verifyStatus === 'VERIFIED')
      .map((d) => String(d.docType)),
  );
  return policy.verificationRequired.filter((type) => !verified.has(type));
}

/**
 * Documents already past their expiry date. An expired police verification is
 * as good as none — this is what the expiry-reminder job acts on and what stops
 * a long-serving teacher drifting out of compliance unnoticed.
 */
export function expiredDocuments(
  documents: DocumentLike[],
  asOf: Date = new Date(),
): DocumentLike[] {
  return documents.filter(
    (d) => d.expiryDate instanceof Date && d.expiryDate.getTime() < asOf.getTime(),
  );
}

/**
 * The KYC flag derived from the documents, so it can never disagree with them.
 * Stored on the profile only because assignment filters on it on every search
 * and must not join the document table to do it.
 *
 * `REJECTED` wins over `PENDING`: an applicant with one rejected document needs
 * to act, and showing "pending" would hide that.
 */
export function deriveKycStatus(
  policy: OnboardingPolicy,
  documents: DocumentLike[],
): KycStatus {
  if (documents.length === 0) return 'NOT_SUBMITTED';

  const required = new Set(policy.verificationRequired);
  const relevant = documents.filter((d) => required.has(String(d.docType)));

  if (relevant.some((d) => d.verifyStatus === 'REJECTED')) return 'REJECTED';
  if (unverifiedDocuments(policy, documents).length > 0) return 'PENDING';
  if (expiredDocuments(documents).length > 0) return 'PENDING';
  return 'VERIFIED';
}

// -------------------------------------------------------------------- profile

/** Fields an applicant must fill before the application is reviewable. */
export function missingProfileFields(applicant: ApplicantLike): string[] {
  const missing: string[] = [];
  if (applicant.name.trim().length === 0) missing.push('name');
  if (!applicant.bio || applicant.bio.trim().length === 0) missing.push('bio');
  if (applicant.languages.length === 0) missing.push('languages');
  if (applicant.specialisations.length === 0) missing.push('specialisations');
  // The home base is what distance scoring measures from; without it the
  // applicant can never be ranked for a booking.
  if (applicant.homeBaseLat == null || applicant.homeBaseLng == null) {
    missing.push('homeBase');
  }
  return missing;
}

// ---------------------------------------------------------------------- gates

/**
 * May this applicant submit for review? Profile complete, every required
 * document uploaded, and the code of conduct accepted.
 */
export function canSubmitForReview(
  policy: OnboardingPolicy,
  applicant: ApplicantLike,
  documents: DocumentLike[],
): Gate {
  const reasons: string[] = [];

  const fields = missingProfileFields(applicant);
  if (fields.length > 0) {
    reasons.push(`Complete your profile: ${fields.join(', ')}`);
  }

  const missing = missingDocuments(policy, documents);
  if (missing.length > 0) {
    reasons.push(`Upload these documents: ${missing.join(', ')}`);
  }

  if (!applicant.codeOfConductAt) {
    reasons.push('Accept the code of conduct');
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * May this applicant be approved? Everything submission needs, plus every
 * must-verify document actually verified and unexpired. Admin cannot click
 * through this — an approved teacher is one we send into a stranger's home.
 */
export function canApprove(
  policy: OnboardingPolicy,
  applicant: ApplicantLike,
  documents: DocumentLike[],
): Gate {
  const gate = canSubmitForReview(policy, applicant, documents);
  const reasons = [...gate.reasons];

  const unverified = unverifiedDocuments(policy, documents);
  if (unverified.length > 0) {
    reasons.push(`Awaiting verification: ${unverified.join(', ')}`);
  }

  const expired = expiredDocuments(documents);
  if (expired.length > 0) {
    reasons.push(
      `Expired documents: ${expired.map((d) => String(d.docType)).join(', ')}`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}

// ------------------------------------------------------------- stage machine

/**
 * Stages reachable from `current`, honouring the policy's optional steps.
 *
 * Rules, in one place so the controller cannot invent a shortcut:
 * - forward one step at a time, skipping any step the policy disables;
 * - `REJECTED` from any non-terminal stage;
 * - back one step, so ops can undo a misclick (`APPROVED` → `DEMO_SESSION`);
 * - `REJECTED` → `APPLIED` to reopen an application.
 */
export function allowedTransitions(
  policy: OnboardingPolicy,
  current: OnboardingStage,
): OnboardingStage[] {
  if (current === 'REJECTED') return ['APPLIED'];

  const path = STAGE_SEQUENCE.filter(
    (stage) =>
      (stage !== 'SCREENING_CALL' || policy.screeningCallRequired) &&
      (stage !== 'DEMO_SESSION' || policy.demoSessionRequired),
  );

  const index = path.indexOf(current);
  // A stage the policy has since disabled: let ops move forward out of it
  // rather than stranding the applicant.
  if (index === -1) return [...path.slice(1), 'REJECTED'];

  const next: OnboardingStage[] = [];
  if (index > 0) next.push(path[index - 1]);
  if (index < path.length - 1) next.push(path[index + 1]);
  if (current !== 'APPROVED') next.push('REJECTED');

  return next;
}

export function canTransition(
  policy: OnboardingPolicy,
  from: OnboardingStage,
  to: OnboardingStage,
): boolean {
  return allowedTransitions(policy, from).includes(to);
}

/**
 * Where the applicant is, as a percentage, for the app's "Application status"
 * card. Based on the stages this policy actually uses, so disabling the demo
 * step does not leave everyone stuck at 75%.
 */
export function stageProgressPercent(
  policy: OnboardingPolicy,
  stage: OnboardingStage,
): number {
  if (stage === 'REJECTED') return 0;
  if (stage === 'APPROVED') return 100;

  const path = STAGE_SEQUENCE.filter(
    (s) =>
      (s !== 'SCREENING_CALL' || policy.screeningCallRequired) &&
      (s !== 'DEMO_SESSION' || policy.demoSessionRequired),
  );
  const index = path.indexOf(stage);
  if (index === -1) return 0;
  return Math.round((index / (path.length - 1)) * 100);
}

/**
 * Can this teacher be offered work? The hard filter assignment applies, kept
 * here so the two can never drift: approved, KYC verified, no expired document.
 */
export function isEligibleForWork(
  stage: OnboardingStage,
  kycStatus: KycStatus,
  documents: DocumentLike[],
  asOf: Date = new Date(),
): boolean {
  return (
    stage === 'APPROVED' &&
    kycStatus === 'VERIFIED' &&
    expiredDocuments(documents, asOf).length === 0
  );
}
