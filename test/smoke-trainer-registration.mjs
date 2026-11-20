/**
 * Registration, end to end, as the trainer app walks it: the wizard in the
 * app's own order (12 → 13 → 14 → 15 → 16 → 18 → 20 → 21), asserting the
 * blocker list shrinks to nothing on the way.
 *
 * `smoke-trainer-profile` and `smoke-trainer-documents` test the pieces — the
 * columns round-trip, a file reaches storage. Neither answers the question the
 * client asked: **can a trainer who fills in every screen get submitted?**
 * That is a property of the gate, which broke twice on 19-11-2026 in ways a
 * green build could not show.
 *
 * Run: `npm run smoke:trainer-registration` (needs NODE_ENV=development).
 */
import { smoke, day } from './smoke-harness.mjs';
import { uploadTo } from './multipart-upload.mjs';

const s = smoke();
const { mobile } = await s.loginCustomer();

/** Every type `settings.defaults.onboarding.requiredDocuments` demands. */
const REQUIRED_DOCUMENTS = [
  'ID_PROOF',
  'ADDRESS_PROOF',
  'PAN',
  'BANK_DETAILS',
  'YOGA_CERTIFICATION',
  'POLICE_VERIFICATION',
  'PHOTO',
];

/** One wizard step: the app saves each screen with its own PATCH. */
const patch = (body, expect = 200) =>
  s.call('PATCH', '/app/instructor/profile', body, expect, 'instructor');

const onboarding = async () =>
  (await s.call('GET', '/app/instructor/profile', undefined, 200, 'instructor'))
    ?.data?.onboarding;

s.section('a customer applies, and that is what grants INSTRUCTOR');
const applied = await s.call(
  'POST',
  '/app/instructor/apply',
  { name: 'Registration Smoke', gender: 'FEMALE', experienceYears: 4 },
  201,
  'customer',
);
s.check('the application opens at APPLIED', applied?.data?.onboarding?.stage, 'APPLIED');
s.check('and at 0%', applied?.data?.onboarding?.progressPercent, 0);
s.check('nothing is submittable yet', applied?.data?.onboarding?.canSubmit, false);

s.section('applying twice is a conflict, not a second profile');
const again = await s.call('POST', '/app/instructor/apply', { name: 'Twice' }, 409, 'customer');
s.check('and says why', s.errorCode(again), 'APPLICATION_EXISTS');

s.section('the customer token cannot read the application it just created');
// The role is minted at OTP verify, so the old token predates INSTRUCTOR.
await s.call('GET', '/app/instructor/profile', undefined, 403, 'customer');

const sent = await s.call('POST', '/auth/otp/send', { mobile }, 200, 'none');
const verified = await s.call(
  'POST',
  '/auth/otp/verify',
  { mobile, code: sent?.data?.devCode },
  200,
  'none',
);
const token = verified?.data?.accessToken;
s.setToken('instructor', token);
s.check('re-login carries INSTRUCTOR', verified?.data?.user?.roles?.includes('INSTRUCTOR'), true);

s.section('the gate on a fresh application asks for exactly three things');
const fresh = await onboarding();
s.check('name came from apply, so only bio and specialisations are missing',
  fresh?.missingProfileFields, ['bio', 'specialisations']);
// Client, 19-11-2026: languages and homeBase were dropped from the gate —
// neither has a screen in the 74-page pack, so demanding them was unpassable.
s.check('languages is no longer demanded', fresh?.missingProfileFields.includes('languages'), false);
s.check('homeBase is no longer demanded', fresh?.missingProfileFields.includes('homeBase'), false);
s.check('all seven documents are outstanding', fresh?.missingDocuments, REQUIRED_DOCUMENTS);
s.check('the code of conduct is outstanding', fresh?.codeOfConductAccepted, false);

s.section('page 12 — create profile');
const page12 = await patch({ name: 'Registration Smoke', dob: '1994-03-18', gender: 'FEMALE' });
s.check('name stored', page12?.data?.name, 'Registration Smoke');
s.check('gender stored', page12?.data?.gender, 'FEMALE');
// Hard rule 4: every date on the wire reads dd-mm-yyyy. ISO is still accepted
// on the way in while the four surfaces catch up, so both are sent here.
s.check('an ISO dob comes back dd-mm-yyyy', page12?.data?.dob, '18-03-1994');
s.check('and dd-mm-yyyy is accepted too',
  (await patch({ dob: '02-07-1991' }))?.data?.dob, '02-07-1991');
await patch({ dob: '31-02-1991' }, 400);

s.section('page 13 — personal information');
const page13 = await patch({
  addressLine: '44 Lake View Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  country: 'India',
});
s.check('address stored', page13?.data?.addressLine, '44 Lake View Road');

s.section('page 14 — professional details, which is where bio lives');
const page14 = await patch({
  experienceYears: 6,
  qualification: 'RYT-500',
  institute: 'Yoga Vidya',
  clientsTrainedBand: '26-50',
  bio: 'Six years teaching hatha and prenatal yoga in customers homes.',
});
s.check('experience stored as an int', page14?.data?.experienceYears, 6);
s.check('bio clears its blocker', page14?.data?.onboarding?.missingProfileFields, ['specialisations']);

s.section('page 15 — specialisation');
const page15 = await patch({ specialisations: ['Hatha Yoga', 'Prenatal Yoga'] });
s.check('the profile half of the gate is clear', page15?.data?.onboarding?.missingProfileFields, []);

s.section('page 16 — the seven required documents');
for (const docType of REQUIRED_DOCUMENTS) {
  const fields = { docType };
  // The only type with a real expiry; an expired one blocks approval, not
  // submission, so it is set in the future to keep the two gates apart.
  if (docType === 'POLICE_VERIFICATION') fields.expiryDate = day(365);
  const up = await uploadTo('/app/instructor/documents', token, fields);
  s.check(`${docType} accepted`, up.status, 201);
}
const afterDocs = await onboarding();
s.check('no document outstanding', afterDocs?.missingDocuments, []);
s.check('every must-verify one is still unverified', afterDocs?.unverifiedDocuments.length > 0, true);
s.check('and none is expired', afterDocs?.expiredDocuments, []);

s.section('page 18 — service areas');
const page18 = await patch({
  serviceLocality: 'Koregaon Park',
  travelRadiusKm: 12,
});
s.check('radius stored', page18?.data?.travelRadiusKm, 12);
// Session location went on 20-11-2026 (client): home-service only, every
// trainer travels to the customer. Page 18 keeps locality + radius only, and
// the old field must now be refused outright.
await patch({ sessionFormats: ['CUSTOMER_HOME'] }, 400);

s.section('page 20 — payout');
await s.call(
  'PUT',
  '/app/instructor/bank-account',
  { payoutMethod: 'UPI', upiId: 'registration.smoke@hdfc' },
  200,
  'instructor',
);

s.section('submit is refused until the code of conduct is accepted');
const early = await s.call('POST', '/app/instructor/submit', undefined, 400, 'instructor');
s.check('refusal is the onboarding code', s.errorCode(early), 'ONBOARDING_INCOMPLETE');
const beforeTick = await onboarding();
s.check('the code of conduct is the only thing left', beforeTick?.blockedBy,
  ['Accept the code of conduct']);

const accepted = await s.call('POST', '/app/instructor/code-of-conduct', undefined, 200, 'instructor');
s.check('acceptedAt is dd-mm-yyyy HH:mm:ss',
  /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(accepted?.data?.acceptedAt ?? ''), true);

const ready = await onboarding();
s.check('nothing blocks submission now', ready?.blockedBy, []);
s.check('canSubmit flipped', ready?.canSubmit, true);

s.section('submit moves the application on');
const submitted = await s.call('POST', '/app/instructor/submit', undefined, 200, 'instructor');
s.check('stage advanced', submitted?.data?.onboarding?.stage, 'DOCUMENTS_SUBMITTED');
s.check('progress moved off zero', submitted?.data?.onboarding?.progressPercent > 0, true);
s.check('kyc is pending a reviewer', submitted?.data?.kycStatus, 'PENDING');

s.section('submitting twice is refused');
const twice = await s.call('POST', '/app/instructor/submit', undefined, 409, 'instructor');
s.check('stage is locked', s.errorCode(twice), 'ONBOARDING_STAGE_LOCKED');

s.section('page 22 — the status card reads off the same payload');
const status = await onboarding();
s.check('stage', status?.stage, 'DOCUMENTS_SUBMITTED');
s.check('the applicant is told what the reviewer owes them',
  status?.unverifiedDocuments.length > 0, true);

s.section('page 23 — the preview carries no price: admin sets every price');
const preview = await s.call('GET', '/app/instructor/profile', undefined, 200, 'instructor');
s.check('no price field on the trainer profile',
  Object.keys(preview?.data ?? {}).some((k) => /price|rate|fee|amount/i.test(k)), false);

s.section('the routes are shut without a token');
await s.noToken('GET', '/app/instructor/profile');
await s.noToken('PATCH', '/app/instructor/profile', { name: 'x' });
await s.noToken('POST', '/app/instructor/submit');
await s.noToken('POST', '/app/instructor/code-of-conduct');

await s.cleanup(async (db) => {
  const user = await db.user.findUnique({ where: { mobile } });
  if (user) await db.user.delete({ where: { id: user.id } });
});

s.done();
