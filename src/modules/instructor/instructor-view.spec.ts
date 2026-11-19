import { decorateProfile, documentView, profileDates } from './instructor-view';
import { DEFAULT_SETTINGS } from '../settings/settings.defaults';

/**
 * The wire shape of a profile and a document — hard rule 4 above all. The
 * calculator itself is covered by `onboarding.spec.ts`; this file is about the
 * dates and the private storage key.
 */
const policy = DEFAULT_SETTINGS.onboarding;

const profile = {
  name: 'Asha',
  experienceYears: 4,
  languages: ['en'],
  specialisations: ['yoga'],
  bio: 'Ten years of hatha',
  onboardingStage: 'APPLIED' as const,
  dob: new Date(Date.UTC(1994, 2, 18)),
  joinedAt: new Date(Date.UTC(2026, 10, 1)),
  codeOfConductAt: new Date(Date.UTC(2026, 10, 19, 9, 30, 5)),
  createdAt: new Date(Date.UTC(2026, 10, 18, 7, 0, 0)),
  updatedAt: new Date(Date.UTC(2026, 10, 19, 9, 31, 0)),
};

describe('profileDates', () => {
  it('writes a calendar day as dd-mm-yyyy and an instant with the clock', () => {
    const dates = profileDates(profile);

    expect(dates.dob).toBe('18-03-1994');
    expect(dates.joinedAt).toBe('01-11-2026');
    expect(dates.codeOfConductAt).toBe('19-11-2026 09:30:05');
    expect(dates.createdAt).toBe('18-11-2026 07:00:00');
  });

  it('keeps a null column null rather than inventing a day', () => {
    expect(profileDates({ ...profile, dob: null, joinedAt: null })).toMatchObject(
      { dob: null, joinedAt: null },
    );
  });
});

describe('decorateProfile', () => {
  it('formats the dates and keeps the onboarding checklist', () => {
    const view = decorateProfile(policy, profile, []);

    expect(view.dob).toBe('18-03-1994');
    expect(view.onboarding.stage).toBe('APPLIED');
    expect(view.onboarding.codeOfConductAccepted).toBe(true);
    // The checklist is the pure calculator's, not re-derived here.
    expect(view.onboarding.missingDocuments).toEqual(policy.requiredDocuments);
  });
});

describe('documentView', () => {
  const row = {
    id: 'doc-1',
    docType: 'PAN' as const,
    verifyStatus: 'VERIFIED' as const,
    fileUrl: 'instructors/abc/pan-123.pdf',
    issueDate: new Date(Date.UTC(2020, 0, 31)),
    expiryDate: new Date(Date.UTC(2030, 5, 1)),
    verifiedAt: new Date(Date.UTC(2026, 10, 19, 14, 30, 5)),
    createdAt: new Date(Date.UTC(2026, 10, 18, 7, 0, 0)),
    updatedAt: new Date(Date.UTC(2026, 10, 19, 14, 30, 5)),
  };

  it('never leaks the private storage key', () => {
    expect(documentView(row)).not.toHaveProperty('fileUrl');
  });

  it('formats every date it carries', () => {
    const view = documentView(row);

    expect(view.issueDate).toBe('31-01-2020');
    expect(view.expiryDate).toBe('01-06-2030');
    expect(view.verifiedAt).toBe('19-11-2026 14:30:05');
    expect(view.createdAt).toBe('18-11-2026 07:00:00');
  });

  it('leaves an unverified document with a null verifiedAt', () => {
    const view = documentView({
      ...row,
      verifyStatus: 'PENDING',
      verifiedAt: null,
      issueDate: null,
      expiryDate: null,
    });

    expect(view.verifiedAt).toBeNull();
    expect(view.expiryDate).toBeNull();
  });
});
