import {
  canSubmitForReview,
  expiredDocuments,
  missingDocuments,
  missingProfileFields,
  stageProgressPercent,
  unverifiedDocuments,
  type DocumentLike,
} from './onboarding';
import {
  formatDateOrNull,
  formatDateTimeOrNull,
} from '../../common/dates/format';
import type { OnboardingStage } from '../../generated/prisma/enums';
import type { OnboardingPolicy } from '../settings/settings.defaults';

/**
 * What an instructor profile and its documents look like on the wire.
 *
 * Pure functions on purpose: the trainer app and the admin panel both render
 * these shapes, and the two surfaces cannot be allowed to disagree about what
 * is missing or how a date reads. Takes the resolved policy rather than
 * `SettingsService`, so it needs no injection and is directly testable.
 *
 * Hard rule 4: every date out of here is `dd-mm-yyyy`, a timestamp
 * `dd-mm-yyyy HH:mm:ss`. The columns stay real `date` / `timestamptz` — only
 * the way out changes. → `state/date-format.md`
 */

/** The profile columns the onboarding view reads. */
export interface ProfileForView {
  name: string;
  bio?: string | null;
  experienceYears: number;
  languages: string[];
  specialisations: string[];
  homeBaseLat?: unknown;
  homeBaseLng?: unknown;
  codeOfConductAt?: Date | null;
  dob?: Date | null;
  joinedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  onboardingStage: OnboardingStage;
}

/** A document row as it comes back from Prisma. */
export interface DocumentForView extends DocumentLike {
  id?: string;
  fileUrl?: string;
  issueDate?: Date | null;
  verifiedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * The onboarding view both the app and the admin panel render: where the
 * applicant is, what is still missing, and what is blocking approval.
 * Assembled from the pure calculator so the two surfaces cannot diverge.
 */
export function decorateProfile<T extends ProfileForView>(
  policy: OnboardingPolicy,
  profile: T,
  documents: DocumentLike[],
) {
  const submission = canSubmitForReview(policy, profile, documents);

  return {
    ...profile,
    ...profileDates(profile),
    onboarding: {
      stage: profile.onboardingStage,
      progressPercent: stageProgressPercent(policy, profile.onboardingStage),
      requiredDocuments: policy.requiredDocuments,
      missingDocuments: missingDocuments(policy, documents),
      unverifiedDocuments: unverifiedDocuments(policy, documents),
      expiredDocuments: expiredDocuments(documents).map((d) =>
        String(d.docType),
      ),
      missingProfileFields: missingProfileFields(profile),
      codeOfConductAccepted: Boolean(profile.codeOfConductAt),
      canSubmit: submission.ok,
      blockedBy: submission.reasons,
    },
  };
}

/**
 * The date columns of a profile, formatted. `dob` is the calendar day; the rest
 * are instants, so they carry the clock.
 */
export function profileDates(profile: ProfileForView) {
  return {
    dob: formatDateOrNull(profile.dob),
    ...('joinedAt' in profile && {
      joinedAt: formatDateOrNull(profile.joinedAt),
    }),
    ...('codeOfConductAt' in profile && {
      codeOfConductAt: formatDateTimeOrNull(profile.codeOfConductAt),
    }),
    ...(profile.createdAt && {
      createdAt: formatDateTimeOrNull(profile.createdAt),
    }),
    ...(profile.updatedAt && {
      updatedAt: formatDateTimeOrNull(profile.updatedAt),
    }),
  };
}

/**
 * A document row for a response: dates formatted and `fileUrl` gone.
 *
 * `fileUrl` is an object key in the private bucket and must never leave the
 * server — the caller gets a short-lived signed URL from a separate route. The
 * strip is here, in one place, rather than repeated at each of the five call
 * sites that return a document.
 */
export function documentView<T extends DocumentForView>(document: T) {
  const { fileUrl: _fileUrl, ...rest } = document;

  return {
    ...rest,
    issueDate: formatDateOrNull(document.issueDate),
    expiryDate: formatDateOrNull(document.expiryDate),
    ...(('verifiedAt' in document) && {
      verifiedAt: formatDateTimeOrNull(document.verifiedAt),
    }),
    ...(document.createdAt && {
      createdAt: formatDateTimeOrNull(document.createdAt),
    }),
    ...(document.updatedAt && {
      updatedAt: formatDateTimeOrNull(document.updatedAt),
    }),
  };
}
