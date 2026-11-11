/**
 * The website's Notifications page, through `/app/notifications/*`.
 *
 * The page derives its Bookings / Payments / Offers tabs from the `eventKey`
 * prefix, so the field it groups on is asserted here. Its three channel
 * switches are the API's own channels at the `*` sentinel — the one mapping
 * that is exact — so each is flipped and read back.
 *
 *   npm run smoke:web-notifications
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

s.section('the list the page renders');

const { mobile } = await s.loginCustomer();

const list = await s.call('GET', '/app/notifications?limit=50', undefined, 200, 'customer');
s.check('rows is an array', Array.isArray(list?.data), true);
s.check('meta carries the unread count', typeof list?.meta?.unread, 'number');
s.check('a new account has nothing', list?.data?.length, 0);
s.check('unread is zero to match', list?.meta?.unread, 0);

const badge = await s.call('GET', '/app/notifications/unread-count', undefined, 200, 'customer');
s.check('badge count agrees with the list', badge?.data?.unread, 0);

// The page filters on `unreadOnly` through the same route.
await s.call('GET', '/app/notifications?unreadOnly=true', undefined, 200, 'customer');
await s.call('GET', '/app/notifications?limit=0', undefined, 400, 'customer');

s.section('marking read');

// Both buttons the page draws end up here. A notification that is not this
// user's must update nothing rather than 500 — the route filters on the pair.
const foreign = await s.call(
  'POST',
  '/app/notifications/00000000-0000-4000-8000-000000000000/read',
  undefined,
  200,
  'customer',
);
s.check('a foreign id updates nothing', foreign?.data?.updated, 0);
s.check('and reports the real unread count', foreign?.data?.unread, 0);

await s.call('POST', '/app/notifications/not-a-uuid/read', undefined, 400, 'customer');

const all = await s.call('POST', '/app/notifications/read-all', undefined, 200, 'customer');
s.check('read-all answers a count', typeof all?.data?.updated, 'number');
s.check('read-all leaves nothing unread', all?.data?.unread, 0);

s.section('the three channel switches');

const prefs = await s.call('GET', '/app/notifications/preferences', undefined, 200, 'customer');
s.check('defaults to sending', prefs?.data?.defaultEnabled, true);
s.check('no overrides yet', prefs?.data?.overrides?.length, 0);

for (const channel of ['EMAIL', 'SMS', 'PUSH']) {
  await s.call('PUT', '/app/notifications/preferences', { channel, eventKey: '*', enabled: false }, 200, 'customer');
}

const off = await s.call('GET', '/app/notifications/preferences', undefined, 200, 'customer');
s.check('three overrides stored', off?.data?.overrides?.length, 3);
s.check(
  'all three are off at the sentinel',
  off?.data?.overrides?.every((row) => row.eventKey === '*' && row.enabled === false),
  true,
);

// The PUT is an upsert, not an insert: flipping back must not make a fourth row.
await s.call('PUT', '/app/notifications/preferences', { channel: 'EMAIL', eventKey: '*', enabled: true }, 200, 'customer');
const back = await s.call('GET', '/app/notifications/preferences', undefined, 200, 'customer');
s.check('still three rows', back?.data?.overrides?.length, 3);
s.check(
  'email is on again',
  back?.data?.overrides?.find((row) => row.channel === 'EMAIL')?.enabled,
  true,
);

await s.call('PUT', '/app/notifications/preferences', { channel: 'CARRIER_PIGEON', enabled: true }, 400, 'customer');

s.section('rejections');

await s.noToken('GET', '/app/notifications');
await s.noToken('GET', '/app/notifications/preferences');
await s.noToken('POST', '/app/notifications/read-all');

await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile }, select: { id: true } });
  if (!user) return;
  await db.notificationPreference.deleteMany({ where: { userId: user.id } });
  await db.inAppNotification.deleteMany({ where: { userId: user.id } });
  await db.customerProfile.deleteMany({ where: { userId: user.id } });
  await db.refreshToken.deleteMany({ where: { userId: user.id } });
  await db.otpRequest.deleteMany({ where: { mobile } });
  await db.user.delete({ where: { id: user.id } });
});

s.done();
