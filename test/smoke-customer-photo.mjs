/**
 * Smoke test for the customer profile photo — `POST`/`DELETE`
 * `/app/customer/profile/photo` (client, 27-11-2026).
 *
 * The one thing a build cannot prove here: the photo is served **unsigned**.
 * So the suite does not stop at the 200 — it takes the URL the API returns and
 * fetches it with no Authorization header at all, the way an `<img>` on the
 * profile page will. A key written outside `public/` would 403 there while
 * every other assertion still passed.
 */
import { smoke } from './smoke-harness.mjs';
import { uploadTo, PNG } from './multipart-upload.mjs';

const s = smoke();
const PHOTO = '/app/customer/profile/photo';

s.section('a signed-out visitor cannot touch the photo');
await s.noToken('DELETE', PHOTO);

s.section('new customer, no photo');
const me = await s.loginCustomer();
await s.call('PATCH', '/app/customer/profile', { name: 'Photo Tester' }, 200, 'customer');

const fresh = await s.call('GET', '/app/customer/profile', undefined, 200, 'customer');
s.check('photoUrl starts null', fresh?.data?.photoUrl, null);

s.section('upload');
const uploaded = await uploadTo(PHOTO, me.token, {});
s.check('upload status', uploaded.status, 200);

const url = uploaded.json?.data?.photoUrl ?? '';
s.check('photoUrl is set', url.length > 0, true);
s.check('key is public', url.includes('/files/public/customers/'), true);
s.check('key is not the filename', url.endsWith('photo.png'), false);

s.section('the photo is readable with no token, like an <img>');
const anonymous = await fetch(url);
s.check('anonymous GET', anonymous.status, 200);
s.check('content type', anonymous.headers.get('content-type'), 'image/png');
s.check('bytes match', Buffer.from(await anonymous.arrayBuffer()).equals(PNG), true);

s.section('replacing it mints a new key');
const replaced = await uploadTo(PHOTO, me.token, {});
s.check('replace status', replaced.status, 200);
s.check('new url', replaced.json?.data?.photoUrl !== url, true);
s.check('old object gone', (await fetch(url)).status, 404);

s.section('what is refused');
const noFile = await uploadTo(PHOTO, me.token, {}, { body: null });
s.check('no file -> 400', noFile.status, 400);
s.check('no file code', s.errorCode(noFile.json), 'VALIDATION_FAILED');

const asPdf = await uploadTo(PHOTO, me.token, {}, {
  filename: 'scan.pdf',
  type: 'application/pdf',
});
s.check('pdf -> 400', asPdf.status, 400);
s.check('pdf code', s.errorCode(asPdf.json), 'DOCUMENT_TYPE_NOT_ALLOWED');

s.section('remove');
const removed = await s.call('DELETE', PHOTO, undefined, 200, 'customer');
s.check('photoUrl cleared', removed?.data?.photoUrl, null);
s.check('object deleted', (await fetch(replaced.json.data.photoUrl)).status, 404);

// Removing a photo that is not there is a no-op, not a 404: the page's Remove
// button is drawn from state the browser may have cached.
const again = await s.call('DELETE', PHOTO, undefined, 200, 'customer');
s.check('second remove is a no-op', again?.data?.photoUrl, null);

s.done();
