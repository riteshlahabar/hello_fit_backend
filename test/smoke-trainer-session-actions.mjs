/**
 * Page 32's two buttons — Completed and Cancel (client, 23-11-2026).
 *
 * The OTP path, both cancel branches, and that the new status is what every
 * other surface reads: the bucket summary, the filter chips and the earning
 * row all move off the one tap.
 *
 * Run: `npm run smoke:trainer-session-actions` (needs NODE_ENV=development
 * for devCode).
 */
import { smoke } from './smoke-harness.mjs';
import { createWorld, removeWorld } from './trainer-app-fixture.mjs';

const s = smoke();
const stamp = String(Date.now()).slice(-9);
const mobile = `9${stamp}`.slice(0, 10);

const made = await s.cleanup((db) => createWorld(db, stamp, mobile));

s.section('sign the fixture trainer in');
const sent = await s.call('POST', '/auth/otp/send', { mobile }, 200, 'none');
const verified = await s.call(
  'POST',
  '/auth/otp/verify',
  { mobile, code: sent?.data?.devCode },
  200,
  'none',
);
s.setToken('instructor', verified?.data?.accessToken);

const as = (method, path, body, expect = 200) =>
  s.call(method, path, body, expect, 'instructor');

// sessionIds: 0,1 COMPLETED · 2 ASSIGNED today · 3 ASSIGNED +4d · 4 CONFIRMED +6d
const [, , today, upcoming, confirmed] = made.sessionIds;

s.section('page 32 offers both buttons on a live booking');
const before = await as('GET', `/app/instructor/bookings/${upcoming}`);
s.check('status is ASSIGNED', before?.data?.status, 'ASSIGNED');
s.check('Completed is offered', before?.data?.canComplete, true);
s.check('Cancel is offered', before?.data?.canCancel, true);

s.section('the code is the proof — a wrong one does not complete');
const wrong = await as(
  'POST',
  `/app/instructor/bookings/${upcoming}/complete`,
  { otp: '9999' },
  400,
);
s.check('rejected as a bad code', s.errorCode(wrong), 'OTP_INVALID');
const stillOpen = await as('GET', `/app/instructor/bookings/${upcoming}`);
s.check('status untouched by the failed attempt', stillOpen?.data?.status, 'ASSIGNED');
await as('POST', `/app/instructor/bookings/${upcoming}/complete`, { otp: '12' }, 400);

s.section('Completed — one tap writes COMPLETED and the earning');
const done = await as(
  'POST',
  `/app/instructor/bookings/${upcoming}/complete`,
  { otp: '1234' },
  201,
);
s.check('session id echoed', done?.data?.sessionId, upcoming);
s.check('earning raised', typeof done?.data?.earning?.id, 'string');
s.check('earning is the session value', done?.data?.earning?.sessionValue, 800);
s.check('commission taken at 25%', done?.data?.earning?.commissionAmount, 200);
s.check('net to the trainer', done?.data?.earning?.netAmount, 600);
s.check('earning waits out the dispute window', done?.data?.earning?.status, 'PENDING');

s.section('and the status is COMPLETED everywhere the trainer looks');
const after = await as('GET', `/app/instructor/bookings/${upcoming}`);
s.check('detail says COMPLETED', after?.data?.status, 'COMPLETED');
s.check('pill follows', after?.data?.statusLabel, 'COMPLETED');
s.check('bucket follows', after?.data?.bucket, 'completed');
s.check('no second Completed', after?.data?.canComplete, false);
s.check('and nothing left to cancel', after?.data?.canCancel, false);
const list = await as('GET', '/app/instructor/bookings');
s.check('summary counts three completed', list?.meta?.summary?.completed, 3);
s.check('completed chip returns it', (await as('GET', '/app/instructor/bookings?status=completed'))?.data?.length, 3);

s.section('a completed session cannot be completed or cancelled again');
await as('POST', `/app/instructor/bookings/${upcoming}/complete`, { otp: '1234' }, 400);
await as(
  'POST',
  `/app/instructor/bookings/${upcoming}/cancel`,
  { reason: 'Changed my mind' },
  400,
);

s.section('Cancel, client absent — NO_SHOW_CUSTOMER, charged per policy');
const absent = await as(
  'POST',
  `/app/instructor/bookings/${confirmed}/cancel`,
  { reason: 'Client was not available at the address', clientAbsent: true },
  201,
);
s.check('status is the customer no-show', absent?.data?.status, 'NO_SHOW_CUSTOMER');
s.check('slab recorded', absent?.data?.refund?.slab, 'CUSTOMER_NO_SHOW');
s.check('nothing refunded at a 100% charge', absent?.data?.refund?.amount, 0);
s.check('no goodwill on a customer no-show', absent?.data?.refund?.goodwillCredit, 0);
const absentRow = await as('GET', `/app/instructor/bookings/${confirmed}`);
s.check('detail agrees', absentRow?.data?.status, 'NO_SHOW_CUSTOMER');
s.check('and it reads as cancelled', absentRow?.data?.bucket, 'cancelled');

s.section('Cancel, any other reason — CANCELLED_BY_TEACHER, full refund');
const own = await as(
  'POST',
  `/app/instructor/bookings/${today}/cancel`,
  { reason: 'Medical emergency' },
  201,
);
s.check('status is the trainer cancellation', own?.data?.status, 'CANCELLED_BY_TEACHER');
s.check('customer refunded in full', own?.data?.refund?.percent, 100);
s.check('refund is the session value', own?.data?.refund?.amount, 800);
s.check('goodwill on top', own?.data?.refund?.goodwillCredit, 100);
s.check('credited to the wallet', own?.data?.refund?.mode, 'WALLET');
s.check('wallet balance returned', String(own?.data?.walletBalance), '800');

s.section('the reason is compulsory, and only the owner may close a booking');
await as('POST', `/app/instructor/bookings/${today}/cancel`, {}, 400);
await as('POST', `/app/instructor/bookings/${today}/cancel`, { reason: 'no' }, 400);
await as(
  'POST',
  '/app/instructor/bookings/11111111-1111-4111-8111-111111111111/complete',
  { otp: '1234' },
  404,
);
await s.noToken('POST', `/app/instructor/bookings/${upcoming}/complete`, { otp: '1234' });
await s.noToken('POST', `/app/instructor/bookings/${upcoming}/cancel`, { reason: 'x' });

s.section('the audit trail carries every one of those transitions');
await s.cleanup(async (db) => {
  const history = await db.bookingStatusHistory.findMany({
    where: { bookingId: made.bookingId },
    select: { sessionId: true, fromStatus: true, toStatus: true, actorType: true },
  });
  const of = (id) => history.find((h) => h.sessionId === id);
  s.check('three rows written', history.length, 3);
  s.check('completion logged', of(upcoming)?.toStatus, 'COMPLETED');
  s.check('from its previous status', of(upcoming)?.fromStatus, 'ASSIGNED');
  s.check('actor is the trainer', of(upcoming)?.actorType, 'INSTRUCTOR');
  s.check('no-show logged', of(confirmed)?.toStatus, 'NO_SHOW_CUSTOMER');
  s.check('cancellation logged', of(today)?.toStatus, 'CANCELLED_BY_TEACHER');

  const withheld = await db.earning.findFirst({
    where: { sessionId: today },
    select: { status: true },
  });
  s.check('no earning survives a trainer cancellation', withheld, null);

  await removeWorld(db, made);
});

s.done();
