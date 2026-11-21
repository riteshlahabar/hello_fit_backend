/**
 * The website's booking flow, end to end — client, 21-11-2026.
 *
 * Three things a green `npm run build` cannot prove:
 *
 *   1. **`GET /providers?serviceId=`** shows only providers an administrator
 *      approved for *that* service. "Show the trainer according to service
 *      selection, means who trainer assign to service." A category filter was
 *      not enough: a category holds several services.
 *   2. **A provider with no availability rule still offers start times.**
 *      Nothing in the system writes `availability_rules` (PDF §4.6 puts it on
 *      the provider's own app, page 67, unbuilt), so every grid was empty by
 *      construction. `openBandsFor` treats no rule as open across the
 *      institute window; the customer picks a start and the end follows from
 *      the service duration.
 *   3. **The package is the price.** A quote carrying `packageId` must come
 *      back adjusted, not at `Service.basePrice` — "show the price which
 *      service select, it is not base price".
 *
 *   npm run smoke:web-booking-flow
 */
import { smoke, day } from './smoke-harness.mjs';
import { createProvider, removeProvider } from './provider-search-fixture.mjs';
import { extend, removeExtras } from './booking-flow-fixture.mjs';

const s = smoke();
const stamp = String(Date.now()).slice(-6);

/** Institute window and granularity — `settings.defaults.ts`, not invented. */
const OPEN_MINUTE = 5 * 60;
const CLOSE_MINUTE = 22 * 60;
const GRANULARITY = 30;
const DURATION = 60;
const BASE_PRICE = 900;

let made = { userId: '', providerId: '', serviceId: '', categoryId: '', areaId: '', cityId: '' };
let extra = { secondServiceId: '', packageId: '', pincodeId: '', pin: '' };
/** @type {string[]} */
const addressIds = [];
/** @type {string[]} */
const bookingIds = [];

s.section('fixtures: a provider with an unapproved offering and no availability rules');

await s.cleanup(async (db) => {
  made = await createProvider(db, stamp);
  extra = await extend(db, made, stamp);

  const rules = await db.availabilityRule.count({ where: { instructorId: made.providerId } });
  s.check('the provider really has no weekly rule', rules, 0);
});

s.section('a provider is invisible until the service is approved for them');

const before = await s.call('GET', `/providers?serviceId=${made.serviceId}`, undefined, 200, 'none');
s.check('unapproved, so not listed', (before?.data ?? []).some((p) => p.id === made.providerId), false);

await s.withAdmin(async () => {
  await s.call('PATCH', `/admin/instructors/${made.providerId}`, {
    serviceIds: [made.serviceId],
  });
});

s.section('GET /providers?serviceId= — only who is assigned to that service');

const listed = await s.call('GET', `/providers?serviceId=${made.serviceId}`, undefined, 200, 'none');
const mine = (listed?.data ?? []).find((p) => p.id === made.providerId);
s.check('approved, so listed for that service', Boolean(mine), true);
s.check('and the card prices that service', mine?.fromPrice, BASE_PRICE);
s.check('only that service rides on the row', mine?.serviceCount, 1);

const other = await s.call(
  'GET', `/providers?serviceId=${extra.secondServiceId}`, undefined, 200, 'none',
);
s.check(
  'same category, different service: absent',
  (other?.data ?? []).some((p) => p.id === made.providerId),
  false,
);

const byCategory = await s.call(
  'GET', `/providers?categoryId=${made.categoryId}`, undefined, 200, 'none',
);
s.check(
  'the category filter still finds them',
  (byCategory?.data ?? []).some((p) => p.id === made.providerId),
  true,
);

await s.call('GET', '/providers?serviceId=not-a-uuid', undefined, 400, 'none');

s.section('an address resolves its own area from the PIN alone');

await s.loginCustomer();

const address = await s.call('POST', '/app/customer/addresses', {
  label: 'Home', line1: `${stamp} Booking Flow Road`, pincode: extra.pin,
}, 201, 'customer');
addressIds.push(address?.data?.id);
s.check('area resolved without the client sending one', address?.data?.areaId, made.areaId);

s.section('start times with no weekly rule — the open-window fallback');

const grid = await s.call(
  'GET',
  `/app/customer/slots?serviceId=${made.serviceId}&date=${day(2)}` +
    `&addressId=${address?.data?.id}&instructorId=${made.providerId}`,
  undefined, 200, 'customer',
);

const slots = grid?.data ?? [];
s.check('the grid is not empty', slots.length > 0, true);
s.check('every session is the service duration long',
  slots.every((o) => o.toMinute - o.fromMinute === DURATION), true);
s.check('every start is on the granularity',
  slots.every((o) => o.fromMinute % GRANULARITY === 0), true);
s.check('nothing starts before the institute opens',
  slots.every((o) => o.fromMinute >= OPEN_MINUTE), true);
s.check('nothing ends after it closes',
  slots.every((o) => o.toMinute <= CLOSE_MINUTE), true);
s.check('the first start is the opening minute', slots[0]?.fromMinute, OPEN_MINUTE);
s.check('the last session ends at closing', slots[slots.length - 1]?.toMinute, CLOSE_MINUTE);

s.section('the package is the price, not Service.basePrice');

const plain = await s.call('POST', '/app/customer/bookings/quote', {
  serviceId: made.serviceId,
}, 201, 'customer');
s.check('no package quotes the service rate', plain?.data?.grossAmount, BASE_PRICE);

const packaged = await s.call('POST', '/app/customer/bookings/quote', {
  serviceId: made.serviceId, packageId: extra.packageId,
}, 201, 'customer');
s.check('the package adjusts it', packaged?.data?.grossAmount, BASE_PRICE * 0.9);
s.check('and it is cheaper than the base price',
  Number(packaged?.data?.grossAmount) < BASE_PRICE, true);

const foreign = await s.call('POST', '/app/customer/bookings/quote', {
  serviceId: extra.secondServiceId, packageId: extra.packageId,
}, 404, 'customer');
s.check('a package not sold on the service is refused', s.errorCode(foreign), 'NOT_FOUND');

s.section('a customer-chosen start time books');

const chosen = slots.find((o) => o.fromMinute === 9 * 60) ?? slots[0];

const created = await s.call('POST', '/app/customer/bookings', {
  serviceId: made.serviceId,
  packageId: extra.packageId,
  addressId: address?.data?.id,
  instructorId: made.providerId,
  sessionDate: day(2),
  fromMinute: chosen.fromMinute,
  toMinute: chosen.toMinute,
  source: 'WEBSITE',
  preferences: { goal: 'Improve flexibility', level: 'Beginner' },
}, 201, 'customer');

bookingIds.push(created?.data?.id);
s.check('the booking holds the slot', created?.data?.paymentStatus, 'UNPAID');
s.check('priced at the package rate', Number(created?.data?.payable) > 0, true);

s.section('the development gateway settles it — "make payment not work"');

const order = await s.call('POST', '/app/customer/payments/order', {
  bookingId: created?.data?.id,
}, 201, 'customer');

s.check('no credentials, so the development gateway answers', order?.data?.gateway, 'MANUAL');
s.check('and its key is the placeholder the real sheet rejects', order?.data?.publicKey, 'dev_key');

const settled = await s.call('POST', '/app/customer/payments/dev-settle', {
  bookingId: created?.data?.id,
}, 201, 'customer');
s.check('the payment is captured', settled?.data?.status, 'CAPTURED');

const paid = await s.call(
  'GET', `/app/customer/bookings/${created?.data?.id}`, undefined, 200, 'customer',
);
s.check('the booking is paid', paid?.data?.paymentStatus, 'PAID');

// A double click cannot pay twice: the booking is no longer unpaid, so the
// order step refuses before any signing happens.
const again = await s.call('POST', '/app/customer/payments/dev-settle', {
  bookingId: created?.data?.id,
}, 409, 'customer');
s.check('a settled booking cannot be settled again', s.errorCode(again), 'DUPLICATE_RESOURCE');

await s.noToken('POST', '/app/customer/payments/dev-settle', { bookingId: created?.data?.id });
await s.noToken('GET', `/app/customer/slots?serviceId=${made.serviceId}`);

s.section('cleanup');

await s.cleanup(async (db) => {
  await removeExtras(db, made, extra, addressIds.filter(Boolean), bookingIds.filter(Boolean));
  await removeProvider(db, made);
});

s.done();
