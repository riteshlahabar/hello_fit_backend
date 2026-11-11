/**
 * The website's Profile & settings page (PDF §5.9), through the two routes it
 * reads and writes.
 *
 * What is new here and why it is tested: `GET /app/customer/profile` now
 * carries the account's mobile and email from `User` (the page shows them
 * beside the name, and they live on the other table), and the PATCH accepts
 * `email` — §3.2's "update name and contact information". `User.email` is
 * unique, so the refusal matters as much as the success.
 *
 *   npm run smoke:web-profile
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

s.section('profile shape');

const first = await s.loginCustomer();

const profile = await s.call('GET', '/app/customer/profile', undefined, 200, 'customer');
s.check('mobile comes from the user row', profile?.data?.user?.mobile, first.mobile);
s.check('email starts null', profile?.data?.user?.email, null);
s.check('isComplete is false for a fresh account', profile?.data?.isComplete, false);
s.check('referralCode is issued', typeof profile?.data?.referralCode, 'string');

s.section('saving the form');

const email = `web-${Date.now()}@hellofit.test`;

const saved = await s.call(
  'PATCH',
  '/app/customer/profile',
  { name: 'Web Tester', gender: 'FEMALE', dob: '1997-05-14', healthNotes: 'Sore left knee', email },
  200,
  'customer',
);

s.check('name saved', saved?.data?.name, 'Web Tester');
s.check('gender saved', saved?.data?.gender, 'FEMALE');
s.check('health notes saved', saved?.data?.healthNotes, 'Sore left knee');
s.check('email saved onto the user row', saved?.data?.user?.email, email);
s.check('isComplete flips once named', saved?.data?.isComplete, true);
// A date column: the day must come back as given, not shifted by a timezone.
s.check('dob is the same calendar day', String(saved?.data?.dob).slice(0, 10), '1997-05-14');
s.check('PATCH answers the GET shape', saved?.data?.user?.mobile, first.mobile);

s.section('refusals');

await s.call('PATCH', '/app/customer/profile', { email: 'not-an-email' }, 400, 'customer');
await s.call('PATCH', '/app/customer/profile', { dob: '' }, 400, 'customer');
await s.call('PATCH', '/app/customer/profile', { name: 'x' }, 400, 'customer');

s.section('the email is unique across accounts');

const second = await s.loginCustomer();
const clash = await s.call('PATCH', '/app/customer/profile', { email }, 409, 'customer');
s.check('refused as a duplicate', s.errorCode(clash), 'DUPLICATE_RESOURCE');
// The refusal must not have written anything on the way past.
const untouched = await s.call('GET', '/app/customer/profile', undefined, 200, 'customer');
s.check('second account still has no email', untouched?.data?.user?.email, null);

s.section('the address the page manages');

const created = await s.call(
  'POST',
  '/app/customer/addresses',
  { label: 'Home', line1: '14 Baner Road', pincode: '411045' },
  201,
  'customer',
);

s.check('address created', created?.data?.line1, '14 Baner Road');
s.check('the first address is the default', created?.data?.isDefault, true);
// The website cannot set a city or area — there is no public master list —
// so the page relies on these being optional. Asserted so a future change
// that makes them mandatory fails here rather than in the browser.
s.check('city is null without a picker', created?.data?.cityId, null);
s.check('area is null without a picker', created?.data?.areaId, null);

const patched = await s.call(
  'PATCH',
  `/app/customer/addresses/${created?.data?.id}`,
  { line1: '14 Baner Road, Flat 3', pincode: '411046' },
  200,
  'customer',
);
s.check('address edited', patched?.data?.line1, '14 Baner Road, Flat 3');
s.check('pincode edited', patched?.data?.pincode, '411046');

const list = await s.call('GET', '/app/customer/addresses', undefined, 200, 'customer');
s.check('one address listed', list?.data?.length, 1);
s.check('the default is first', list?.data?.[0]?.isDefault, true);

await s.call('PATCH', `/app/customer/addresses/${created?.data?.id}`, { pincode: '0' }, 400, 'customer');

s.section('rejections');

await s.noToken('GET', '/app/customer/profile');
await s.noToken('PATCH', '/app/customer/profile', { name: 'Nobody' });
await s.noToken('GET', '/app/customer/addresses');

await s.cleanup(async (db) => {
  for (const mobile of [first.mobile, second.mobile]) {
    const user = await db.user.findFirst({ where: { mobile }, select: { id: true } });
    if (!user) continue;
    const profiles = await db.customerProfile.findMany({ where: { userId: user.id }, select: { id: true } });
    await db.address.deleteMany({ where: { customerId: { in: profiles.map((p) => p.id) } } });
    await db.customerProfile.deleteMany({ where: { userId: user.id } });
    await db.refreshToken.deleteMany({ where: { userId: user.id } });
    await db.otpRequest.deleteMany({ where: { mobile } });
    await db.user.delete({ where: { id: user.id } });
  }
});

s.done();
