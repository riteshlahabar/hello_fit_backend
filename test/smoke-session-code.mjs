/**
 * Smoke test for the session code on the customer's side (client,
 * 27-11-2026): `checkInOtp` must reach `GET /app/customer/bookings` as well
 * as `GET /app/customer/bookings/:id`, because "My Bookings" shows the next
 * session's code on the card and the detail screen shows all of them.
 *
 * A green build proves nothing about a Prisma `select` — this drives one.
 * It reads the DB for a customer who already owns a booking rather than
 * seeding one: the shape is what is under test, not the booking flow, which
 * `smoke-web-booking-flow` already covers.
 *
 *   npm run build && node -r dotenv/config dist/main.js &
 *   npm run smoke:session-code
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const CODE = /^\d{4}$/;

/** A customer with at least one session, and their login mobile. */
const owner = await s.cleanup(async (db) => {
  const session = await db.bookingSession.findFirst({
    where: { booking: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      bookingId: true,
      booking: {
        select: {
          customer: { select: { user: { select: { mobile: true } } } },
        },
      },
    },
  });

  return session
    ? { bookingId: session.bookingId, mobile: session.booking.customer.user.mobile }
    : null;
});

if (!owner) {
  console.log('  ! no booking in this database; run smoke:web-booking-flow');
  s.done();
}

await s.loginCustomer(owner.mobile);

s.section('the list carries the code');

const list = await s.call(
  'GET',
  '/app/customer/bookings',
  undefined,
  200,
  'customer',
);
s.check('rows is an array', Array.isArray(list?.data), true);

const booking = (list?.data ?? []).find((b) => b.sessions?.length);
s.check('this customer owns a booking with sessions', !!booking, true);

for (const session of booking?.sessions ?? []) {
  s.check(
    `list session ${session.sequence} carries a four-digit code`,
    CODE.test(String(session.checkInOtp ?? '')),
    true,
  );
}

s.section('the detail route carries it too');

const detail = await s.call(
  'GET',
  `/app/customer/bookings/${booking.id}`,
  undefined,
  200,
  'customer',
);
const first = detail?.data?.sessions?.[0];
s.check('detail session has a code', CODE.test(String(first?.checkInOtp)), true);
s.check(
  'list and detail agree on the code',
  first?.checkInOtp,
  booking.sessions[0].checkInOtp,
);

s.section('it is the owner’s code and nobody else’s');

// The code is what closes a booking, so reaching it must need the owner's
// token. `listForCustomer` is scoped by the customer the controller resolved
// from the token; this is the assertion that the scoping is really there.
await s.noToken('GET', '/app/customer/bookings');

await s.loginCustomer();
const theirs = await s.call(
  'GET',
  '/app/customer/bookings',
  undefined,
  200,
  'customer',
);
s.check(
  'a different customer sees none of those bookings',
  (theirs?.data ?? []).some((b) => b.id === booking.id),
  false,
);

s.done();
