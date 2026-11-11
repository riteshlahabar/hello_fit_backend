/**
 * The website's booking and checkout pages (PDF §5.7, §5.8).
 *
 * The chain the pages walk — catalog, slots, quote, booking, order, verify —
 * driven against the real server, including the one rule US-W09 insists on:
 * an unverified client-side payment response must not confirm anything. A bad
 * signature is refused and the booking stays unpaid; a good one settles it.
 *
 * On a developer machine the gateway is `MANUAL`, which signs with a fixed
 * secret, so the happy path is reachable. Against real Razorpay credentials
 * the suite skips those two assertions rather than failing.
 *
 * It also pins the gap flagged on the booking page: an address with no
 * service area returns an **empty** slot grid, which is why the page shows
 * "no times available" rather than an error.
 *
 *   npm run smoke:web-checkout
 */
import { createHmac } from 'node:crypto';
import { smoke, day } from './smoke-harness.mjs';

const s = smoke();
const sign = (payload) => createHmac('sha256', 'hellofit-development-only').update(payload).digest('hex');

const { mobile } = await s.loginCustomer();

s.section('the catalog the booking page lists');

const categories = await s.call('GET', '/categories', undefined, 200, 'none');
s.check('categories are public', Array.isArray(categories?.data), true);

const services = await s.call('GET', '/services', undefined, 200, 'none');
const service = services?.data?.[0];

s.check('services are public', Array.isArray(services?.data), true);
s.check('a service carries its price', typeof service?.basePrice, 'string');
s.check('and its duration', typeof service?.durationMin, 'number');
s.check('and the category the card names', typeof service?.category?.name, 'string');

s.section('the price comes from the server');

const quote = await s.call('POST', '/app/customer/bookings/quote', { serviceId: service.id }, 201, 'customer');

s.check('gross is the base price', Number(quote?.data?.grossAmount), Number(service.basePrice));
s.check('payable is a number', typeof quote?.data?.payable, 'number');
s.check('tax is broken out', typeof quote?.data?.tax, 'number');
s.check('travel is broken out', typeof quote?.data?.travelCharge, 'number');
s.check('no coupon applied', quote?.data?.coupon, null);
s.check('one session by default', quote?.data?.sessionCount, 1);

// The coupon field on checkout: a bad code is refused with a reason, which is
// what the page shows under the input.
const badCode = await s.call(
  'POST',
  '/app/customer/bookings/quote',
  { serviceId: service.id, couponCode: 'NOT-A-REAL-CODE' },
  400,
  'customer',
);
s.check('a bad coupon says why', s.errorCode(badCode), 'COUPON_INVALID');

await s.call('POST', '/app/customer/bookings/quote', { serviceId: 'nope' }, 400, 'customer');

s.section('availability needs a service, a day and an address');

const fixture = await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile }, select: { id: true } });
  const profile = await db.customerProfile.findFirst({ where: { userId: user.id }, select: { id: true } });
  const area = await db.serviceArea.findFirst({ where: { isActive: true, deletedAt: null }, select: { id: true, cityId: true } });

  // Two addresses on purpose: one inside a service area, one outside every
  // area — the second is what a website-created address looks like today.
  const inArea = await db.address.create({
    data: {
      customerId: profile.id, label: 'Home', line1: 'In Area', pincode: '411045',
      cityId: area.cityId, areaId: area.id, isDefault: true,
    },
  });

  const noArea = await db.address.create({
    data: { customerId: profile.id, label: 'Unmapped', line1: 'No Area', pincode: '999999' },
  });

  return { profileId: profile.id, inArea: inArea.id, noArea: noArea.id };
});

const tomorrow = day(1);

const slots = await s.call(
  'GET',
  `/app/customer/slots?serviceId=${service.id}&date=${tomorrow}&addressId=${fixture.inArea}`,
  undefined,
  200,
  'customer',
);
s.check('the grid is a list', Array.isArray(slots?.data), true);
s.check('meta echoes the day asked for', slots?.meta?.date, tomorrow);

const unmapped = await s.call(
  'GET',
  `/app/customer/slots?serviceId=${service.id}&date=${tomorrow}&addressId=${fixture.noArea}`,
  undefined,
  200,
  'customer',
);
s.check('an address outside every area has no times', unmapped?.data?.length, 0);

// Each is required; the page cannot query until it has all three.
await s.call(`GET`, `/app/customer/slots?serviceId=${service.id}&date=${tomorrow}`, undefined, 400, 'customer');
await s.call('GET', `/app/customer/slots?date=${tomorrow}&addressId=${fixture.inArea}`, undefined, 400, 'customer');
await s.call(
  'GET',
  `/app/customer/slots?serviceId=${service.id}&date=yesterday&addressId=${fixture.inArea}`,
  undefined,
  400,
  'customer',
);

s.section('creating a booking');

await s.call(
  'POST',
  '/app/customer/bookings',
  { serviceId: service.id, addressId: '00000000-0000-4000-8000-000000000000', sessionDate: tomorrow, fromMinute: 600 },
  404,
  'customer',
);

await s.call(
  'POST',
  '/app/customer/bookings',
  { serviceId: service.id, addressId: fixture.inArea, sessionDate: tomorrow, fromMinute: 2000 },
  400,
  'customer',
);

s.section('payment is settled server-side, never by the browser');

const booked = await s.cleanup(async (db) => {
  const booking = await db.booking.create({
    data: {
      code: `HF-WEBCO-${Date.now().toString().slice(-6)}`,
      customerId: fixture.profileId,
      serviceId: service.id,
      addressId: fixture.inArea,
      grossAmount: service.basePrice,
      payable: service.basePrice,
      paymentStatus: 'UNPAID',
      source: 'WEBSITE',
    },
  });

  await db.bookingSession.create({
    data: {
      bookingId: booking.id,
      serviceId: service.id,
      addressId: fixture.inArea,
      sessionDate: new Date(`${tomorrow}T00:00:00.000Z`),
      fromMinute: 600,
      toMinute: 660,
      durationMin: 60,
      sessionValue: service.basePrice,
      status: 'PENDING_PAYMENT',
    },
  });

  return { id: booking.id, code: booking.code };
});

const order = await s.call('POST', '/app/customer/payments/order', { bookingId: booked.id }, 201, 'customer');

s.check('an order is opened', typeof order?.data?.orderId, 'string');
s.check('for the booking amount', Number(order?.data?.amount), Number(service.basePrice));
s.check('with the key the browser needs', typeof order?.data?.publicKey, 'string');
s.check('and the gateway named', typeof order?.data?.gateway, 'string');

// Idempotent: the page may re-open checkout without stacking orders.
const again = await s.call('POST', '/app/customer/payments/order', { bookingId: booked.id }, 201, 'customer');
s.check('re-ordering returns the same order', again?.data?.orderId, order?.data?.orderId);

const forged = await s.call(
  'POST',
  '/app/customer/payments/verify',
  {
    bookingId: booked.id,
    gatewayOrderId: order.data.orderId,
    gatewayPaymentId: 'pay_forged',
    signature: 'definitely-not-a-signature',
  },
  400,
  'customer',
);
s.check('a forged signature is refused', s.errorCode(forged), 'VALIDATION_FAILED');

const stillUnpaid = await s.call('GET', `/app/customer/bookings/${booked.id}`, undefined, 200, 'customer');
s.check('and the booking stays unpaid', stillUnpaid?.data?.paymentStatus, 'UNPAID');

if (order?.data?.gateway === 'MANUAL') {
  const paymentId = 'pay_dev_web_smoke';
  await s.call(
    'POST',
    '/app/customer/payments/verify',
    {
      bookingId: booked.id,
      gatewayOrderId: order.data.orderId,
      gatewayPaymentId: paymentId,
      signature: sign(`${order.data.orderId}|${paymentId}`),
      idempotencyKey: `web-${paymentId}`,
    },
    201,
    'customer',
  );

  const paid = await s.call('GET', `/app/customer/bookings/${booked.id}`, undefined, 200, 'customer');
  s.check('a verified payment confirms the booking', paid?.data?.paymentStatus, 'PAID');
} else {
  console.log(`note: gateway is ${order?.data?.gateway} — the signed happy path was skipped`);
}

s.section('the confirmation page reads the booking back');

const detail = await s.call('GET', `/app/customer/bookings/${booked.id}`, undefined, 200, 'customer');
s.check('the reference it prints', detail?.data?.code, booked.code);
s.check('the service it names', typeof detail?.data?.service?.name, 'string');
s.check('the address it shows', typeof detail?.data?.address?.label, 'string');
s.check('the sessions it lists', Array.isArray(detail?.data?.sessions), true);
s.check('and it is filed as a website booking', detail?.data?.source, 'WEBSITE');

await s.call('GET', '/app/customer/bookings/00000000-0000-4000-8000-000000000000', undefined, 404, 'customer');

s.section('rejections');

await s.noToken('POST', '/app/customer/bookings/quote', { serviceId: service.id });
await s.noToken('GET', `/app/customer/slots?serviceId=${service.id}&date=${tomorrow}&addressId=${fixture.inArea}`);
await s.noToken('POST', '/app/customer/payments/order', { bookingId: booked.id });

await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile }, select: { id: true } });
  if (!user) return;

  await db.walletTransaction.deleteMany({ where: { account: { customerId: fixture.profileId } } });
  await db.walletAccount.deleteMany({ where: { customerId: fixture.profileId } });
  await db.invoice.deleteMany({ where: { bookingId: booked.id } });
  await db.payment.deleteMany({ where: { bookingId: booked.id } });
  await db.bookingStatusHistory.deleteMany({ where: { bookingId: booked.id } });
  await db.earning.deleteMany({ where: { session: { bookingId: booked.id } } });
  await db.assignment.deleteMany({ where: { session: { bookingId: booked.id } } });
  await db.bookingSession.deleteMany({ where: { bookingId: booked.id } });
  await db.booking.deleteMany({ where: { customerId: fixture.profileId } });
  await db.address.deleteMany({ where: { customerId: fixture.profileId } });
  await db.customerProfile.deleteMany({ where: { userId: user.id } });
  await db.refreshToken.deleteMany({ where: { userId: user.id } });
  await db.otpRequest.deleteMany({ where: { mobile } });
  await db.user.delete({ where: { id: user.id } });
});

s.done();
