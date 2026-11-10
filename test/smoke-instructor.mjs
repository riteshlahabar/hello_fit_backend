/**
 * End-to-end smoke test for teacher onboarding and KYC, against the real
 * server, the real database and the real storage port.
 *
 * What it proves: an applicant can now go from "never seen before" to an
 * `APPROVED`, KYC-verified teacher entirely through the API, and that the
 * gates refuse at every point they should. Before this module there were no
 * instructor endpoints at all — `InstructorProfile` rows had to be inserted by
 * hand, which is why `assignment`'s "KYC verified" filter could never pass on
 * real data.
 *
 *  * Needs: the server on :3000 in development (for `devCode`) and a seeded
 * database (for the super-admin role). The admin half mints a throwaway admin
 * and deletes it again, so no credentials have to be shared — see
 * `admin-fixture.mjs`.
 */
const BASE = 'http://localhost:3000/api/v1';
const mobile = '9' + String(Date.now()).slice(-9);
import { auditedActionCount, withTemporaryAdmin } from './admin-fixture.mjs';

let token = '';
let adminToken = '';
let pass = 0;
let fail = 0;

async function call(method, path, body, expect = 200, asAdmin = false) {
  const bearer = asAdmin ? adminToken : token;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  if (ok) pass += 1;
  else fail += 1;
  const label = `${ok ? 'PASS' : 'FAIL'}  ${method} ${path}`;
  console.log(
    `${label.padEnd(62)} ${res.status}${ok ? '' : ` (wanted ${expect})`}` +
      (ok ? '' : `  ${JSON.stringify(json).slice(0, 240)}`),
  );
  return json;
}

/** Multipart upload of a tiny in-memory file. */
async function upload(docType, { mime = 'application/pdf', bytes = 2048, expiryDate } = {}, expect = 201) {
  const form = new FormData();
  form.set('docType', docType);
  if (expiryDate) form.set('expiryDate', expiryDate);
  form.set(
    'file',
    new Blob([new Uint8Array(bytes).fill(37)], { type: mime }),
    `${docType.toLowerCase()}.${mime === 'application/pdf' ? 'pdf' : 'png'}`,
  );

  const res = await fetch(`${BASE}/app/instructor/documents`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    `${(ok ? 'PASS  ' : 'FAIL  ') + `upload ${docType}`.padEnd(56)} ${res.status}` +
      (ok ? '' : ` (wanted ${expect})  ${JSON.stringify(json).slice(0, 240)}`),
  );
  return json;
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    ((ok ? 'PASS  ' : 'FAIL  ') + label).padEnd(62) +
      ` ${JSON.stringify(actual)}${ok ? '' : ` (wanted ${JSON.stringify(expected)})`}`,
  );
}

// ------------------------------------------------------------- 1. applicant
console.log('\n--- OTP login, brand-new mobile ---');
const send = await call('POST', '/auth/otp/send', { mobile });
const devCode = send?.data?.devCode;
if (!devCode) {
  console.error('no devCode — NODE_ENV must be development for this test');
  process.exit(1);
}
const verify = await call('POST', '/auth/otp/verify', { mobile, code: devCode });
token = verify?.data?.accessToken ?? '';
check('got an access token', token.length > 20, true);

// A fresh account holds only CUSTOMER, so the instructor routes are closed.
console.log('\n--- before applying: instructor routes are shut ---');
await call('GET', '/app/instructor/profile', null, 403);

// --------------------------------------------------------------- 2. apply
console.log('\n--- apply: creates the profile and grants the role ---');
const applied = await call(
  'POST',
  '/app/instructor/apply',
  { name: 'Smoke Teacher', gender: 'FEMALE', experienceYears: 6 },
  201,
);
check('stage starts at APPLIED', applied?.data?.onboarding?.stage, 'APPLIED');
check('progress starts at 0', applied?.data?.onboarding?.progressPercent, 0);
check('cannot submit yet', applied?.data?.onboarding?.canSubmit, false);
check(
  'every required document is listed as missing',
  applied?.data?.onboarding?.missingDocuments?.length,
  7,
);
await call('POST', '/app/instructor/apply', { name: 'Twice' }, 409);

// The role is on the old token; re-login to pick it up.
const send2 = await call('POST', '/auth/otp/send', { mobile });
const verify2 = await call('POST', '/auth/otp/verify', {
  mobile,
  code: send2?.data?.devCode,
});
token = verify2?.data?.accessToken ?? '';
check(
  'token now carries INSTRUCTOR',
  verify2?.data?.user?.roles?.includes('INSTRUCTOR'),
  true,
);

// -------------------------------------------------------------- 3. profile
console.log('\n--- submission is refused while the profile is short ---');
const early = await call('POST', '/app/instructor/submit', null, 400);
check('refused with ONBOARDING_INCOMPLETE', early?.error?.code, 'ONBOARDING_INCOMPLETE');
check('and says why', Array.isArray(early?.error?.details), true);

console.log('\n--- complete the professional profile ---');
await call('PATCH', '/app/instructor/profile', {
  bio: 'Hatha and prenatal yoga, six years in Pune.',
  languages: ['en', 'mr', 'hi'],
  specialisations: ['hatha', 'prenatal'],
  homeBaseLat: 18.5204,
  homeBaseLng: 73.8567,
  travelRadiusKm: 12,
});
// Half a coordinate is refused: a lone latitude scores against longitude 0.
await call('PATCH', '/app/instructor/profile', { homeBaseLat: 19.1 }, 400);

const afterProfile = await call('GET', '/app/instructor/profile');
check('no profile fields missing now', afterProfile?.data?.onboarding?.missingProfileFields, []);
check('still cannot submit — documents and code outstanding', afterProfile?.data?.onboarding?.canSubmit, false);

// ------------------------------------------------------------ 4. documents
console.log('\n--- upload validation ---');
await upload('ID_PROOF', { mime: 'text/html' }, 400);
await upload('ID_PROOF', { bytes: 11 * 1024 * 1024 }, 400);

console.log('\n--- upload the required set ---');
const first = await upload('ID_PROOF');
const idProofId = first?.data?.id;
check('stored as PENDING', first?.data?.verifyStatus, 'PENDING');
check('the storage key never leaves the server', 'fileUrl' in (first?.data ?? {}), false);

for (const type of ['ADDRESS_PROOF', 'PAN', 'BANK_DETAILS', 'YOGA_CERTIFICATION', 'PHOTO']) {
  await upload(type);
}
await upload('POLICE_VERIFICATION', { expiryDate: '2028-01-31' });

const docs = await call('GET', '/app/instructor/documents');
check('seven documents on file', docs?.meta?.count, 7);

// Re-uploading replaces rather than duplicates.
await upload('PHOTO', { mime: 'image/png' });
const afterReplace = await call('GET', '/app/instructor/documents');
check('replacing a document does not duplicate it', afterReplace?.meta?.count, 7);

console.log('\n--- the teacher can fetch a short-lived link to their own file ---');
const link = await call('GET', `/app/instructor/documents/${idProofId}/url`);
check('got a signed URL', typeof link?.data?.url === 'string' && link.data.url.includes('sig='), true);
check('and it expires', link?.data?.expiresInSeconds > 0, true);

const fileRes = await fetch(link?.data?.url?.startsWith('http') ? link.data.url : `http://localhost:3000${link.data.url}`);
check('the signed URL serves the file', fileRes.status, 200);
check('served as an attachment, never inline', fileRes.headers.get('content-disposition'), 'attachment');
check('and is not cacheable', fileRes.headers.get('cache-control'), 'no-store, private');

const tampered = await fetch(
  (link.data.url.startsWith('http') ? link.data.url : `http://localhost:3000${link.data.url}`).replace(/sig=.*/, 'sig=deadbeef'),
);
check('a tampered signature is refused', tampered.status, 403);

// ------------------------------------------------------------- 5. submit
console.log('\n--- code of conduct, then submit ---');
const stillBlocked = await call('POST', '/app/instructor/submit', null, 400);
check('blocked only on the code of conduct now', stillBlocked?.error?.details?.length, 1);

await call('POST', '/app/instructor/code-of-conduct', null, 200);
const submitted = await call('POST', '/app/instructor/submit', null, 200);
check('stage advanced', submitted?.data?.onboarding?.stage, 'DOCUMENTS_SUBMITTED');
check('kyc is pending review', submitted?.data?.kycStatus, 'PENDING');
await call('POST', '/app/instructor/submit', null, 409);

// --------------------------------------------------------------- 6. admin
// A throwaway super-admin, created and deleted by the fixture, so the test
// needs no shared credentials and leaves no account behind.
await withTemporaryAdmin(async ({ email, password }) => {
  console.log('\n--- admin: review the application ---');
  const login = await call('POST', '/admin/auth/login', { email, password });
  adminToken = login?.data?.accessToken ?? '';
  check('admin signed in', adminToken.length > 20, true);

  const queue = await call(
    'GET',
    '/admin/instructors?stage=DOCUMENTS_SUBMITTED&limit=5',
    null,
    200,
    true,
  );
  check('the applicant is in the pipeline', queue?.data?.length > 0, true);

  const instructorId = queue?.data?.find((r) => r.name === 'Smoke Teacher')?.id;
  check('found our applicant', typeof instructorId === 'string', true);

  const detail = await call('GET', `/admin/instructors/${instructorId}`, null, 200, true);
  check('approval is blocked on verification', detail?.data?.approval?.ok, false);
  check(
    'and the allowed next stages are listed',
    detail?.data?.allowedStages?.includes('SCREENING_CALL'),
    true,
  );

  // Approving before verification is refused, however the stage got here.
  console.log('\n--- approval cannot be clicked past the document checks ---');
  await call('POST', `/admin/instructors/${instructorId}/stage`, { stage: 'APPROVED', reason: 'rush' }, 400, true);
  await call('POST', `/admin/instructors/${instructorId}/stage`, { stage: 'APPLIED', reason: 'no skipping' }, 200, true);
  await call('POST', `/admin/instructors/${instructorId}/stage`, { stage: 'DEMO_SESSION', reason: 'skip two' }, 400, true);
  await call('POST', `/admin/instructors/${instructorId}/stage`, { stage: 'DOCUMENTS_SUBMITTED', reason: 'back on track' }, 200, true);

  console.log('\n--- verify the documents ---');
  const adminDocs = detail?.data?.documents ?? [];
  const rejectMe = adminDocs.find((d) => d.docType === 'PAN');
  await call(
    'POST',
    `/admin/instructors/${instructorId}/documents/${rejectMe.id}/verify`,
    { verifyStatus: 'REJECTED' },
    400,
    true,
  );
  const rejected = await call(
    'POST',
    `/admin/instructors/${instructorId}/documents/${rejectMe.id}/verify`,
    { verifyStatus: 'REJECTED', remarks: 'Blurred scan, please re-upload' },
    200,
    true,
  );
  check('document rejected', rejected?.data?.verifyStatus, 'REJECTED');

  const afterReject = await call('GET', `/admin/instructors/${instructorId}`, null, 200, true);
  check('kyc drops to REJECTED, not PENDING', afterReject?.data?.kycStatus, 'REJECTED');

  // The teacher replaces it and verification resumes.
  await upload('PAN');
  for (const d of (await call('GET', `/admin/instructors/${instructorId}`, null, 200, true))?.data
    ?.documents ?? []) {
    if (d.verifyStatus !== 'VERIFIED') {
      await call(
        'POST',
        `/admin/instructors/${instructorId}/documents/${d.id}/verify`,
        { verifyStatus: 'VERIFIED' },
        200,
        true,
      );
    }
  }

  const verified = await call('GET', `/admin/instructors/${instructorId}`, null, 200, true);
  check('kyc now VERIFIED', verified?.data?.kycStatus, 'VERIFIED');
  check('approval is open', verified?.data?.approval?.ok, true);

  console.log('\n--- walk the pipeline to APPROVED ---');
  for (const stage of ['SCREENING_CALL', 'DEMO_SESSION', 'APPROVED']) {
    const moved = await call(
      'POST',
      `/admin/instructors/${instructorId}/stage`,
      { stage, reason: 'smoke test' },
      200,
      true,
    );
    check(`moved to ${stage}`, moved?.data?.onboarding?.stage, stage);
  }

  const approved = await call('GET', `/admin/instructors/${instructorId}`, null, 200, true);
  check('joinedAt stamped on approval', typeof approved?.data?.joinedAt === 'string', true);
  check('an approved teacher cannot be rejected outright', approved?.data?.allowedStages, ['DEMO_SESSION']);

  console.log('\n--- a verified document is locked to the teacher ---');
  await upload('PAN', {}, 409);
  const lockedDoc = approved?.data?.documents?.find((d) => d.verifyStatus === 'VERIFIED');
  await call('DELETE', `/app/instructor/documents/${lockedDoc.id}`, null, 409);

  console.log('\n--- ops fields and suspension ---');
  await call(
    'PATCH',
    `/admin/instructors/${instructorId}`,
    { dailySessionCap: 5, travelBufferMin: 45 },
    200,
    true,
  );
  const suspended = await call(
    'POST',
    `/admin/instructors/${instructorId}/status`,
    { status: 'SUSPENDED', reason: 'smoke test suspension' },
    200,
    true,
  );
  check('status changed', suspended?.data?.status, 'SUSPENDED');
  check('and forced off duty, so the slot grid stops offering them', suspended?.data?.dutyStatus, 'OFF_DUTY');
  check('upcoming sessions reported for reassignment', typeof suspended?.data?.upcomingSessions, 'number');
});

// Every admin mutation above must be traceable to the person who made it.
check('admin actions written to the audit trail', auditedActionCount() >= 10, true);

// ------------------------------------------------------------------ result
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
