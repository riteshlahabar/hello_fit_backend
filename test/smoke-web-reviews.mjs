/**
 * The website's Reviews & Ratings page (PDF §5.10 / US-W11).
 *
 * The page needs a completed, unreviewed session to offer anything, so this
 * suite builds one — a booking and a COMPLETED session against the seeded
 * service and instructor — and tears it down afterwards.
 *
 * The assertion that drove a design decision on the page: a review with only
 * an overall rating is **refused**, because `punctuality` and `knowledge` are
 * seeded mandatory. That is why the form renders a star row per criterion
 * instead of copying the overall rating into each one.
 *
 *   npm run smoke:web-reviews
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const { mobile } = await s.loginCustomer();

s.section('criteria drive the form');

const criteria = await s.call('GET', '/app/customer/reviews/criteria', undefined, 200, 'customer');
const mandatory = (criteria?.data ?? []).filter((c) => c.isMandatory).map((c) => c.slug).sort();

s.check('five criteria for this direction', criteria?.data?.length, 5);
s.check('two of them are mandatory', mandatory, ['knowledge', 'punctuality']);
s.check('each carries a name the form labels', typeof criteria?.data?.[0]?.name, 'string');

s.section('nothing to review yet');

const emptyPending = await s.call('GET', '/app/customer/reviews/pending', undefined, 200, 'customer');
s.check('no eligible sessions', emptyPending?.data?.length, 0);

const emptyMine = await s.call('GET', '/app/customer/reviews/mine', undefined, 200, 'customer');
s.check('no reviews written', emptyMine?.data?.length, 0);

// Eligibility is the API's rule, not the page's: an arbitrary session id is
// refused even though the form could never offer one.
await s.call(
  'POST',
  '/app/customer/reviews',
  { sessionId: '00000000-0000-4000-8000-000000000000', overallRating: 5 },
  404,
  'customer',
);
await s.call('POST', '/app/customer/reviews', { sessionId: 'nope', overallRating: 5 }, 400, 'customer');

s.section('a completed session becomes reviewable');

const fixture = await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile }, select: { id: true } });
  const profile = await db.customerProfile.findFirst({ where: { userId: user.id }, select: { id: true } });
  const service = await db.service.findFirst({ where: { isActive: true, deletedAt: null } });
  const instructor = await db.instructorProfile.findFirst({ where: { deletedAt: null }, select: { id: true, name: true } });

  const address = await db.address.create({
    data: { customerId: profile.id, label: 'Home', line1: 'Fixture Lane', pincode: '411045', isDefault: true },
  });

  const booking = await db.booking.create({
    data: {
      code: `HF-WEBRV-${Date.now().toString().slice(-6)}`,
      customerId: profile.id,
      serviceId: service.id,
      addressId: address.id,
      grossAmount: service.basePrice,
      payable: service.basePrice,
      paymentStatus: 'PAID',
    },
  });

  const session = await db.bookingSession.create({
    data: {
      bookingId: booking.id,
      serviceId: service.id,
      addressId: address.id,
      instructorId: instructor.id,
      sessionDate: new Date(),
      fromMinute: 600,
      toMinute: 600 + service.durationMin,
      durationMin: service.durationMin,
      sessionValue: service.basePrice,
      status: 'COMPLETED',
      completedAt: new Date(),
    },
  });

  return { sessionId: session.id, bookingId: booking.id, addressId: address.id, trainer: instructor.name };
});

const pending = await s.call('GET', '/app/customer/reviews/pending', undefined, 200, 'customer');
s.check('the session is now offered', pending?.data?.length, 1);
s.check('with the trainer the card names', pending?.data?.[0]?.instructor?.name, fixture.trainer);
s.check('and the service the option labels', typeof pending?.data?.[0]?.service?.name, 'string');

s.section('the mandatory criteria are enforced');

const missing = await s.call(
  'POST',
  '/app/customer/reviews',
  { sessionId: fixture.sessionId, overallRating: 5, comment: 'Great' },
  400,
  'customer',
);
s.check('refused for the missing scores', s.errorCode(missing), 'VALIDATION_FAILED');
s.check('and it says which', (missing?.error?.details?.missing ?? []).sort(), ['knowledge', 'punctuality']);

await s.call(
  'POST',
  '/app/customer/reviews',
  { sessionId: fixture.sessionId, overallRating: 9, criteria: [{ slug: 'punctuality', score: 5 }] },
  400,
  'customer',
);

s.section('a complete review is accepted');

const submitted = await s.call(
  'POST',
  '/app/customer/reviews',
  {
    sessionId: fixture.sessionId,
    overallRating: 5,
    // The page joins its two text fields with a blank line and splits them back.
    comment: 'A wonderful, motivating session\n\nClear guidance the whole way through.',
    criteria: [
      { slug: 'punctuality', score: 5 },
      { slug: 'knowledge', score: 4 },
    ],
  },
  201,
  'customer',
);

s.check('the review exists', typeof submitted?.data?.id, 'string');

const mine = await s.call('GET', '/app/customer/reviews/mine', undefined, 200, 'customer');
s.check('it is listed', mine?.data?.length, 1);
s.check('with the rating given', mine?.data?.[0]?.overallRating, 5);
s.check('the headline survives the round trip', mine?.data?.[0]?.comment?.split('\n\n')?.[0], 'A wonderful, motivating session');
s.check('the card can name the trainer', mine?.data?.[0]?.session?.instructor?.name, fixture.trainer);
s.check('moderation state is reported', typeof mine?.data?.[0]?.state, 'string');

// One review per session per side — the second attempt is the API's rule.
await s.call(
  'POST',
  '/app/customer/reviews',
  {
    sessionId: fixture.sessionId,
    overallRating: 4,
    criteria: [{ slug: 'punctuality', score: 4 }, { slug: 'knowledge', score: 4 }],
  },
  409,
  'customer',
);

const after = await s.call('GET', '/app/customer/reviews/pending', undefined, 200, 'customer');
s.check('and it leaves the pending list', after?.data?.length, 0);

s.section('rejections');

await s.noToken('GET', '/app/customer/reviews/mine');
await s.noToken('POST', '/app/customer/reviews', { sessionId: fixture.sessionId, overallRating: 5 });

await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile }, select: { id: true } });
  if (!user) return;
  const profiles = await db.customerProfile.findMany({ where: { userId: user.id }, select: { id: true } });
  const ids = profiles.map((p) => p.id);

  await db.reviewCriteriaScore.deleteMany({ where: { review: { bookingId: fixture.bookingId } } });
  await db.review.deleteMany({ where: { bookingId: fixture.bookingId } });
  await db.trustEvent.deleteMany({ where: { customerId: { in: ids } } });
  await db.bookingStatusHistory.deleteMany({ where: { bookingId: fixture.bookingId } });
  await db.earning.deleteMany({ where: { session: { bookingId: fixture.bookingId } } });
  await db.bookingSession.deleteMany({ where: { bookingId: fixture.bookingId } });
  await db.booking.deleteMany({ where: { id: fixture.bookingId } });
  await db.address.deleteMany({ where: { customerId: { in: ids } } });
  await db.customerProfile.deleteMany({ where: { userId: user.id } });
  await db.refreshToken.deleteMany({ where: { userId: user.id } });
  await db.otpRequest.deleteMany({ where: { mobile } });
  await db.user.delete({ where: { id: user.id } });
});

s.done();
