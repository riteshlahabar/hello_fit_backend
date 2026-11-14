/**
 * Saved trainers — client instruction, 13 Nov 2026 (not in the v3 PDF).
 *
 * The assertion that matters is **the one about a provider who stops being
 * public**. Saving is easy; what is easy to get wrong is a saved page that
 * goes on offering a suspended or unverified provider as bookable, because
 * the page looks perfectly healthy either way. The search already filters on
 * `PUBLIC_PROVIDER`; this proves the saved list does too.
 *
 * The idempotence assertions matter for a different reason: the heart is a
 * toggle on a phone and will be tapped twice. Neither direction may error.
 *
 *   npm run smoke:favourites
 */
import { smoke } from './smoke-harness.mjs';
import { createProvider, removeProvider } from './provider-search-fixture.mjs';

const s = smoke();
const stamp = String(Date.now()).slice(-6);

s.section('fixtures: a public provider and a signed-in customer');

let made = { userId: '', providerId: '', serviceId: '', categoryId: '', areaId: '', cityId: '' };
await s.cleanup(async (db) => { made = await createProvider(db, stamp); });

// createProvider leaves the offering unapproved, which is what provider-search
// relies on. Saved trainers needs a public one, so approve it.
await s.withAdmin(async () => {
  await s.call(
    'POST',
    `/admin/instructors/${made.providerId}/services/${made.serviceId}/approval`,
    { approved: true },
  );
});

await s.loginCustomer();

s.section('an empty list is a message, not an error');

const empty = await s.call('GET', '/favourites', undefined, 200, 'customer');
s.check('200 with an array', Array.isArray(empty?.data), true);
s.check('empty flagged', empty?.meta?.empty, true);
s.check('and a message supplied', typeof empty?.message, 'string');

s.section('saving, and saving again');

const saved = await s.call('POST', `/favourites/${made.providerId}`, {}, 200, 'customer');
s.check('saved', saved?.data?.saved, true);
s.check('named in the message', saved?.message?.includes(stamp), true);

// A double tap must not 409.
const again = await s.call('POST', `/favourites/${made.providerId}`, {}, 200, 'customer');
s.check('saving twice is still success', again?.data?.saved, true);

const listed = await s.call('GET', '/favourites', undefined, 200, 'customer');
s.check('one entry, not two', listed?.data?.length, 1);
s.check('it is the right provider', listed?.data?.[0]?.id, made.providerId);

s.section('the saved card is the same card as the search result');

const card = listed?.data?.[0];
s.check('has a name', card?.name?.includes(stamp), true);
s.check('has a from-price', typeof card?.fromPrice, 'number');
s.check('has its categories', card?.categories?.length >= 1, true);
s.check('has session formats', card?.sessionFormats?.length >= 1, true);
s.check('and a saved timestamp', typeof card?.savedAt, 'string');

const ids = await s.call('GET', '/favourites/ids', undefined, 200, 'customer');
s.check('ids route returns it', ids?.data?.includes(made.providerId), true);

s.section('a provider who stops being public stops being listed');

await s.cleanup(async (db) => {
  await db.instructorProfile.update({
    where: { id: made.providerId },
    data: { status: 'SUSPENDED' },
  });
});

const whileSuspended = await s.call('GET', '/favourites', undefined, 200, 'customer');
s.check('suspended: not listed', whileSuspended?.data?.length, 0);

// The row must still exist, so reinstating restores the customer's list
// rather than silently losing it.
await s.cleanup(async (db) => {
  await db.instructorProfile.update({
    where: { id: made.providerId },
    data: { status: 'ACTIVE' },
  });
});

const restored = await s.call('GET', '/favourites', undefined, 200, 'customer');
s.check('reinstated: listed again, not lost', restored?.data?.length, 1);

s.section('KYC lapsing hides them too');

await s.cleanup(async (db) => {
  await db.instructorProfile.update({
    where: { id: made.providerId },
    data: { kycStatus: 'PENDING' },
  });
});

const kyc = await s.call('GET', '/favourites', undefined, 200, 'customer');
s.check('unverified: not listed', kyc?.data?.length, 0);

await s.cleanup(async (db) => {
  await db.instructorProfile.update({
    where: { id: made.providerId },
    data: { kycStatus: 'VERIFIED' },
  });
});

s.section('removing, and removing again');

const removed = await s.call('DELETE', `/favourites/${made.providerId}`, undefined, 200, 'customer');
s.check('removed', removed?.data?.saved, false);

const removedAgain = await s.call('DELETE', `/favourites/${made.providerId}`, undefined, 200, 'customer');
s.check('removing twice is still success', removedAgain?.data?.saved, false);

const afterRemoval = await s.call('GET', '/favourites', undefined, 200, 'customer');
s.check('list is empty again', afterRemoval?.data?.length, 0);

s.section('what must not be reachable');

await s.call('GET', '/favourites', undefined, 401, 'none');
await s.call('POST', `/favourites/${made.providerId}`, {}, 401, 'none');
await s.call('POST', '/favourites/not-a-uuid', {}, 400, 'customer');

// Saving someone who is not public must 404, exactly as the detail route
// does — otherwise the heart becomes a way to discover suspended providers.
await s.cleanup(async (db) => {
  await db.instructorProfile.update({
    where: { id: made.providerId },
    data: { status: 'SUSPENDED' },
  });
});
await s.call('POST', `/favourites/${made.providerId}`, {}, 404, 'customer');

s.section('cleanup');

await s.cleanup(async (db) => {
  await db.favourite.deleteMany({ where: { instructorId: made.providerId } });
  await removeProvider(db, made);
});

s.done();
