import {
  allowedTransitions,
  canApprove,
  canSubmitForReview,
  canTransition,
  deriveKycStatus,
  expiredDocuments,
  isEligibleForWork,
  missingDocuments,
  missingProfileFields,
  stageProgressPercent,
  unverifiedDocuments,
  type ApplicantLike,
  type DocumentLike,
} from './onboarding';
import { DEFAULT_SETTINGS } from '../settings/settings.defaults';
import type { OnboardingPolicy } from '../settings/settings.defaults';
import type { DocumentType, VerifyStatus } from '../../generated/prisma/enums';

const policy: OnboardingPolicy = DEFAULT_SETTINGS.onboarding;

const doc = (
  docType: DocumentType,
  verifyStatus: VerifyStatus = 'VERIFIED',
  expiryDate?: Date | null,
): DocumentLike => ({ docType, verifyStatus, expiryDate });

/** Every required type, all verified. */
const fullSet = (status: VerifyStatus = 'VERIFIED'): DocumentLike[] =>
  policy.requiredDocuments.map((t) => doc(t as DocumentType, status));

const applicant = (over: Partial<ApplicantLike> = {}): ApplicantLike => ({
  name: 'Asha Kulkarni',
  bio: 'Hatha and prenatal yoga, 8 years.',
  experienceYears: 8,
  languages: ['en', 'mr'],
  specialisations: ['hatha', 'prenatal'],
  homeBaseLat: 18.5204,
  homeBaseLng: 73.8567,
  codeOfConductAt: new Date('2026-11-01T10:00:00Z'),
  ...over,
});

describe('missingDocuments', () => {
  it('lists every required type when nothing is uploaded', () => {
    expect(missingDocuments(policy, [])).toEqual(policy.requiredDocuments);
  });

  it('is empty once every required type is present', () => {
    expect(missingDocuments(policy, fullSet())).toEqual([]);
  });

  it('counts a PENDING upload as present — submission does not wait on review', () => {
    expect(missingDocuments(policy, fullSet('PENDING'))).toEqual([]);
  });

  it('counts a REJECTED upload as missing, so the applicant must replace it', () => {
    const docs = fullSet().filter((d) => d.docType !== 'PAN');
    docs.push(doc('PAN', 'REJECTED'));
    expect(missingDocuments(policy, docs)).toEqual(['PAN']);
  });

  it('ignores extra documents that are not required', () => {
    expect(missingDocuments(policy, [...fullSet(), doc('OTHER')])).toEqual([]);
  });
});

describe('unverifiedDocuments', () => {
  it('ignores types that do not need verification', () => {
    // PHOTO is required but not in verificationRequired.
    const docs = fullSet().map((d) =>
      d.docType === 'PHOTO' ? doc('PHOTO', 'PENDING') : d,
    );
    expect(unverifiedDocuments(policy, docs)).toEqual([]);
  });

  it('reports a must-verify type still pending', () => {
    const docs = fullSet().map((d) =>
      d.docType === 'POLICE_VERIFICATION'
        ? doc('POLICE_VERIFICATION', 'PENDING')
        : d,
    );
    expect(unverifiedDocuments(policy, docs)).toEqual(['POLICE_VERIFICATION']);
  });
});

describe('expiredDocuments', () => {
  const asOf = new Date('2026-11-07T00:00:00Z');

  it('flags a document past its expiry', () => {
    const docs = [doc('POLICE_VERIFICATION', 'VERIFIED', new Date('2026-10-01'))];
    expect(expiredDocuments(docs, asOf)).toHaveLength(1);
  });

  it('does not flag one expiring later, or one with no expiry at all', () => {
    const docs = [
      doc('POLICE_VERIFICATION', 'VERIFIED', new Date('2027-01-01')),
      doc('PAN', 'VERIFIED', null),
    ];
    expect(expiredDocuments(docs, asOf)).toEqual([]);
  });
});

describe('deriveKycStatus', () => {
  it('is NOT_SUBMITTED with no documents', () => {
    expect(deriveKycStatus(policy, [])).toBe('NOT_SUBMITTED');
  });

  it('is VERIFIED when every must-verify type is verified and unexpired', () => {
    expect(deriveKycStatus(policy, fullSet())).toBe('VERIFIED');
  });

  it('is PENDING while a must-verify type is still awaiting review', () => {
    expect(deriveKycStatus(policy, fullSet('PENDING'))).toBe('PENDING');
  });

  it('is REJECTED when any must-verify type was rejected — REJECTED beats PENDING', () => {
    const docs = fullSet('PENDING');
    docs[0] = doc(docs[0].docType, 'REJECTED');
    expect(deriveKycStatus(policy, docs)).toBe('REJECTED');
  });

  it('drops back to PENDING when a verified document has expired', () => {
    const docs = fullSet().map((d) =>
      d.docType === 'POLICE_VERIFICATION'
        ? doc('POLICE_VERIFICATION', 'VERIFIED', new Date('2020-01-01'))
        : d,
    );
    expect(deriveKycStatus(policy, docs)).toBe('PENDING');
  });

  it('ignores a rejected document of a type that needs no verification', () => {
    const docs = fullSet().map((d) =>
      d.docType === 'PHOTO' ? doc('PHOTO', 'REJECTED') : d,
    );
    expect(deriveKycStatus(policy, docs)).toBe('VERIFIED');
  });
});

describe('missingProfileFields', () => {
  it('is empty for a complete applicant', () => {
    expect(missingProfileFields(applicant())).toEqual([]);
  });

  it('names each gap', () => {
    expect(
      missingProfileFields(
        applicant({ name: '  ', bio: '', languages: [], homeBaseLat: null }),
      ),
    ).toEqual(['name', 'bio', 'languages', 'homeBase']);
  });

  it('requires both halves of the home base', () => {
    expect(missingProfileFields(applicant({ homeBaseLng: null }))).toEqual([
      'homeBase',
    ]);
  });

  it('does not require experienceYears — a new teacher may have none', () => {
    expect(missingProfileFields(applicant({ experienceYears: 0 }))).toEqual([]);
  });
});

describe('canSubmitForReview', () => {
  it('passes with a complete profile, all documents and the code accepted', () => {
    expect(canSubmitForReview(policy, applicant(), fullSet('PENDING'))).toEqual({
      ok: true,
      reasons: [],
    });
  });

  it('refuses without the code of conduct', () => {
    const gate = canSubmitForReview(
      policy,
      applicant({ codeOfConductAt: null }),
      fullSet('PENDING'),
    );
    expect(gate.ok).toBe(false);
    expect(gate.reasons).toEqual(['Accept the code of conduct']);
  });

  it('reports every reason at once, not just the first', () => {
    const gate = canSubmitForReview(
      policy,
      applicant({ bio: null, codeOfConductAt: null }),
      [],
    );
    expect(gate.ok).toBe(false);
    expect(gate.reasons).toHaveLength(3);
  });

  it('does not require documents to be verified yet', () => {
    expect(canSubmitForReview(policy, applicant(), fullSet('PENDING')).ok).toBe(
      true,
    );
  });
});

describe('canApprove', () => {
  it('passes when everything is verified', () => {
    expect(canApprove(policy, applicant(), fullSet()).ok).toBe(true);
  });

  it('refuses while a must-verify document is only pending', () => {
    const gate = canApprove(policy, applicant(), fullSet('PENDING'));
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join(' ')).toContain('Awaiting verification');
  });

  it('refuses on an expired document even when everything else is verified', () => {
    const docs = fullSet().map((d) =>
      d.docType === 'POLICE_VERIFICATION'
        ? doc('POLICE_VERIFICATION', 'VERIFIED', new Date('2020-01-01'))
        : d,
    );
    const gate = canApprove(policy, applicant(), docs);
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join(' ')).toContain('Expired documents');
  });

  it('is strictly stronger than canSubmitForReview', () => {
    const docs = fullSet('PENDING');
    expect(canSubmitForReview(policy, applicant(), docs).ok).toBe(true);
    expect(canApprove(policy, applicant(), docs).ok).toBe(false);
  });
});

describe('allowedTransitions', () => {
  it('moves forward one step and allows rejection', () => {
    expect(allowedTransitions(policy, 'APPLIED')).toEqual([
      'DOCUMENTS_SUBMITTED',
      'REJECTED',
    ]);
  });

  it('allows one step back, so ops can undo a misclick', () => {
    expect(allowedTransitions(policy, 'SCREENING_CALL')).toEqual([
      'DOCUMENTS_SUBMITTED',
      'DEMO_SESSION',
      'REJECTED',
    ]);
  });

  it('does not allow rejecting someone already approved', () => {
    expect(allowedTransitions(policy, 'APPROVED')).toEqual(['DEMO_SESSION']);
  });

  it('reopens a rejected application back to APPLIED only', () => {
    expect(allowedTransitions(policy, 'REJECTED')).toEqual(['APPLIED']);
  });

  it('skips the demo step when policy disables it', () => {
    const noDemo = { ...policy, demoSessionRequired: false };
    expect(allowedTransitions(noDemo, 'SCREENING_CALL')).toEqual([
      'DOCUMENTS_SUBMITTED',
      'APPROVED',
      'REJECTED',
    ]);
  });

  it('skips both optional steps when both are disabled', () => {
    const minimal = {
      ...policy,
      screeningCallRequired: false,
      demoSessionRequired: false,
    };
    expect(allowedTransitions(minimal, 'DOCUMENTS_SUBMITTED')).toEqual([
      'APPLIED',
      'APPROVED',
      'REJECTED',
    ]);
  });

  it('lets ops move an applicant out of a stage the policy has since disabled', () => {
    const noDemo = { ...policy, demoSessionRequired: false };
    const next = allowedTransitions(noDemo, 'DEMO_SESSION');
    expect(next).toContain('APPROVED');
    expect(next).toContain('REJECTED');
  });
});

describe('canTransition', () => {
  it('permits a legal step', () => {
    expect(canTransition(policy, 'DEMO_SESSION', 'APPROVED')).toBe(true);
  });

  it('refuses skipping the queue', () => {
    expect(canTransition(policy, 'APPLIED', 'APPROVED')).toBe(false);
  });

  it('refuses a transition to the same stage', () => {
    expect(canTransition(policy, 'APPLIED', 'APPLIED')).toBe(false);
  });
});

describe('stageProgressPercent', () => {
  it('runs 0 to 100 across the pipeline', () => {
    expect(stageProgressPercent(policy, 'APPLIED')).toBe(0);
    expect(stageProgressPercent(policy, 'DOCUMENTS_SUBMITTED')).toBe(25);
    expect(stageProgressPercent(policy, 'SCREENING_CALL')).toBe(50);
    expect(stageProgressPercent(policy, 'DEMO_SESSION')).toBe(75);
    expect(stageProgressPercent(policy, 'APPROVED')).toBe(100);
  });

  it('rescales when a step is disabled, so nobody is stranded below 100', () => {
    const noDemo = { ...policy, demoSessionRequired: false };
    expect(stageProgressPercent(noDemo, 'SCREENING_CALL')).toBe(67);
    expect(stageProgressPercent(noDemo, 'APPROVED')).toBe(100);
  });

  it('is 0 for a rejected application', () => {
    expect(stageProgressPercent(policy, 'REJECTED')).toBe(0);
  });
});

describe('isEligibleForWork', () => {
  it('accepts an approved, verified teacher with current documents', () => {
    expect(isEligibleForWork('APPROVED', 'VERIFIED', fullSet())).toBe(true);
  });

  it('refuses before approval, even with KYC verified', () => {
    expect(isEligibleForWork('DEMO_SESSION', 'VERIFIED', fullSet())).toBe(false);
  });

  it('refuses an approved teacher whose KYC is not verified', () => {
    expect(isEligibleForWork('APPROVED', 'PENDING', fullSet())).toBe(false);
  });

  it('refuses an approved, verified teacher holding an expired document', () => {
    const docs = [...fullSet(), doc('PAN', 'VERIFIED', new Date('2020-01-01'))];
    expect(isEligibleForWork('APPROVED', 'VERIFIED', docs)).toBe(false);
  });
});
