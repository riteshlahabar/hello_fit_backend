/**
 * The trainer review page's API surface — client, 26-11-2026: the View dialog
 * became `/management/instructors/:id`, holding the record, the documents,
 * the services and the decision.
 *
 * Two behaviours are new and are what this suite guards:
 *   1. `documentView` now carries `fileKind`, so the page knows whether to
 *      draw a thumbnail or a file tile without ever seeing the object key.
 *   2. The stage note is **optional on anything but a rejection, and required
 *      on a rejection** — `ChangeOnboardingStageDto` decides, not the panel.
 *
 * Run: `npm run smoke:admin-trainer-page` (needs NODE_ENV=development for
 * devCode, and the API running).
 */
import { smoke } from './smoke-harness.mjs';
import { uploadTo } from './multipart-upload.mjs';

const s = smoke();
const { mobile } = await s.loginCustomer();

s.section('apply, then re-login so the token carries INSTRUCTOR');
await s.call('POST', '/app/instructor/apply', { name: 'Review Page Smoke' }, 201, 'customer');

const sent = await s.call('POST', '/auth/otp/send', { mobile }, 200, 'none');
const verified = await s.call(
  'POST',
  '/auth/otp/verify',
  { mobile, code: sent?.data?.devCode },
  200,
  'none',
);
s.setToken('instructor', verified?.data?.accessToken);

s.section('one document, so the page has a card to draw');
const upload = await uploadTo(
  '/app/instructor/documents',
  verified?.data?.accessToken,
  { docType: 'PAN', number: 'ABCDE1234F' },
);
s.check('document uploaded', upload.status, 201);

await s.withAdmin(async () => {
  const list = await s.call('GET', '/admin/instructors?q=Review Page Smoke&limit=5');
  const id = list?.data?.[0]?.id;
  s.check('the new trainer is first in the list', Boolean(id), true);

  s.section('the detail call the page is built on');
  const detail = await s.call('GET', `/admin/instructors/${id}`);
  s.check('documents came back', detail?.data?.documents?.length > 0, true);
  s.check('fileKind on the PNG', detail?.data?.documents?.[0]?.fileKind, 'IMAGE');
  s.check('offerings is a list', Array.isArray(detail?.data?.offerings), true);
  s.check('allowedStages is a list', Array.isArray(detail?.data?.allowedStages), true);
  s.check('approval reasons are given', Array.isArray(detail?.data?.approval?.reasons), true);

  s.section('the note: optional, except on a rejection');
  const noNote = await s.call(
    'POST',
    `/admin/instructors/${id}/stage`,
    { stage: 'DOCUMENTS_SUBMITTED' },
    200,
  );
  s.check('moved with no note at all', noNote?.data?.onboarding?.stage, 'DOCUMENTS_SUBMITTED');

  const bareReject = await s.call(
    'POST',
    `/admin/instructors/${id}/stage`,
    { stage: 'REJECTED' },
    400,
  );
  s.check('a rejection with no note is refused', s.errorCode(bareReject), 'VALIDATION_FAILED');

  const tooShort = await s.call(
    'POST',
    `/admin/instructors/${id}/stage`,
    { stage: 'REJECTED', reason: 'x' },
    400,
  );
  s.check('and a one-character note is refused too', s.errorCode(tooShort), 'VALIDATION_FAILED');

  const rejected = await s.call(
    'POST',
    `/admin/instructors/${id}/stage`,
    { stage: 'REJECTED', reason: 'Documents belong to someone else' },
    200,
  );
  s.check('rejected with a note', rejected?.data?.onboarding?.stage, 'REJECTED');

  s.section('the page still refuses what the API always refused');
  await s.noToken('GET', `/admin/instructors/${id}`);
});

await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile } });
  if (!user) return;
  const profile = await db.instructorProfile.findFirst({ where: { userId: user.id } });
  if (profile) {
    await db.document.deleteMany({ where: { ownerType: 'INSTRUCTOR', ownerId: profile.id } });
    await db.instructorService.deleteMany({ where: { instructorId: profile.id } });
    await db.instructorProfile.delete({ where: { id: profile.id } });
  }
  await db.user.delete({ where: { id: user.id } });
});

s.done();
