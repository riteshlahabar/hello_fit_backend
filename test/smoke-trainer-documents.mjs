/**
 * The upload path, end to end: a real multipart POST of a real file to
 * `/app/instructor/documents`, then the list, then the link.
 *
 * This is the path no suite covered before 19-11-2026 — profile fields and the
 * bank account were tested, a file never was, and the trainer app's photo and
 * document uploads were both broken in ways a build could not show.
 *
 * A profile photo and a KYC scan arrive through the same route and are stored
 * under opposite rules, so both are asserted here: the photo is public,
 * permanent and copied onto `InstructorProfile.photoUrl`; everything else is
 * private and signed.
 *
 * Run: `npm run smoke:trainer-documents` (needs NODE_ENV=development).
 */
import { smoke } from './smoke-harness.mjs';
import { uploadTo } from './multipart-upload.mjs';

const s = smoke();
const { mobile } = await s.loginCustomer();

s.section('apply, then re-login so the token carries INSTRUCTOR');
await s.call('POST', '/app/instructor/apply', { name: 'Doc Smoke' }, 201, 'customer');
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
s.check('role granted', verified?.data?.user?.roles?.includes('INSTRUCTOR'), true);

const upload = (docType, options) =>
  uploadTo('/app/instructor/documents', token, { docType, ...options?.extra }, options);

const profile = () =>
  s.call('GET', '/app/instructor/profile', undefined, 200, 'instructor');

s.section('the profile photo uploads');
const photo = await upload('PHOTO');
s.check('photo accepted', photo.status, 201);
s.check('a row came back', typeof photo.json?.data?.id, 'string');
s.check('docType recorded', photo.json?.data?.docType, 'PHOTO');
// The storage key is stripped from the response on purpose — it is a bucket
// path and the trainer has no business holding it.
s.check('the storage key never reaches the trainer', photo.json?.data?.fileUrl, undefined);

s.section('the uploaded photo is visible afterwards');
const afterPhoto = await s.call('GET', '/app/instructor/documents', undefined, 200, 'instructor');
// The app reads documents from this route and merges them with `withDocuments`;
// the profile payload has never carried them and does not need to.
s.check('PHOTO is in the document list',
  (afterPhoto?.data ?? []).some((d) => d.docType === 'PHOTO'), true);

s.section('and it becomes the profile photo the customer surfaces read');
// `photoUrl` is what provider-search, favourites, reviews and bookings select.
// Nothing wrote it until 19-11-2026, so every card showed no photo.
const withPhoto = await profile();
const photoUrl = withPhoto?.data?.photoUrl;
s.check('photoUrl is set', typeof photoUrl, 'string');
s.check('and absolute, so a phone can load it', /^https?:\/\//.test(photoUrl ?? ''), true);
s.check('and public, not signed', (photoUrl ?? '').includes('/files/public/'), true);
s.check('and carries no expiry', (photoUrl ?? '').includes('expires='), false);

const served = await fetch(photoUrl).catch(() => null);
s.check('the photo serves without a token or a signature', served?.status, 200);
s.check('as an image, so nosniff cannot block it',
  served?.headers?.get('content-type'), 'image/png');
s.check('and is cacheable',
  (served?.headers?.get('cache-control') ?? '').includes('max-age'), true);

s.section('a photo must be an image — a PDF is a KYC scan, not a face');
const pdfPhoto = await upload('PHOTO', {
  filename: 'scan.pdf',
  body: Buffer.from('%PDF-1.4 not a face'),
  type: 'application/pdf',
});
s.check('a PDF profile photo is refused', pdfPhoto.status, 400);
s.check('and says why', s.errorCode(pdfPhoto.json), 'DOCUMENT_TYPE_NOT_ALLOWED');

s.section('a KYC document uploads and lists');
const id = await upload('ID_PROOF', { filename: 'aadhaar.png', extra: { number: 'XXXX1234' } });
s.check('ID_PROOF accepted', id.status, 201);
const documentId = id.json?.data?.id;

const afterId = await s.call('GET', '/app/instructor/documents', undefined, 200, 'instructor');
s.check('two documents now', (afterId?.data ?? []).length >= 2, true);
s.check('number stored', (afterId?.data ?? []).find((d) => d.id === documentId)?.number, 'XXXX1234');
s.check('the storage key never reaches the trainer', (afterId?.data ?? [])[0]?.fileUrl, undefined);

s.section('the signed URL the popup opens actually resolves');
const url = await s.call(
  'GET',
  `/app/instructor/documents/${documentId}/url`,
  undefined,
  200,
  'instructor',
);
const signed = url?.data?.url ?? url?.data;
s.check('the url is absolute, so a phone can open it',
  typeof signed === 'string' && /^https?:\/\//.test(signed), true);
s.check('and it is signed, unlike the photo', (signed ?? '').includes('sig='), true);

const fetched = await fetch(signed).catch(() => null);
s.check('the url serves the file, not a 404', fetched?.status, 200);
s.check('a KYC file is never cached', fetched?.headers?.get('cache-control'), 'no-store, private');

s.section('a KYC file is unreachable without the signature');
const unsigned = await fetch(String(signed).split('?')[0]).catch(() => null);
s.check('stripping the signature is a 403', unsigned?.status, 403);

s.section('bad uploads are refused');
const noFile = await s.call(
  'POST',
  '/app/instructor/documents',
  { docType: 'PHOTO' },
  400,
  'instructor',
);
s.check('a body with no file is refused', noFile !== null, true);
s.check('an unknown docType is refused', (await upload('NOT_A_TYPE')).status, 400);

s.section('replace and delete');
const replaced = await upload('PHOTO', { filename: 'photo2.png' });
s.check('a second PHOTO is accepted', replaced.status, 201);
const newPhotoUrl = (await profile())?.data?.photoUrl;
s.check('the profile photo moved to the new file', newPhotoUrl !== photoUrl, true);

await s.call('DELETE', `/app/instructor/documents/${documentId}`, undefined, 200, 'instructor');
const afterDelete = await s.call('GET', '/app/instructor/documents', undefined, 200, 'instructor');
s.check(
  'the deleted document is gone',
  (afterDelete?.data ?? []).some((d) => d.id === documentId),
  false,
);

s.section('deleting the photo clears the profile, or the card shows a dead link');
const photoRow = (afterDelete?.data ?? []).find((d) => d.docType === 'PHOTO');
await s.call('DELETE', `/app/instructor/documents/${photoRow?.id}`, undefined, 200, 'instructor');
s.check('photoUrl cleared', (await profile())?.data?.photoUrl, null);

s.section('the routes are shut without a token');
await s.noToken('GET', '/app/instructor/documents');
await s.noToken('POST', '/app/instructor/documents', { docType: 'PHOTO' });

await s.cleanup(async (db) => {
  const user = await db.user.findUnique({ where: { mobile } });
  if (user) await db.user.delete({ where: { id: user.id } });
});

s.done();
