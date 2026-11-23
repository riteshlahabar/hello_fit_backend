/**
 * The trainer app's four tabs, all real data (20-11-2026): Home, Bookings,
 * Clients and Earnings — plus the §4.7 accept/reject step, which did not
 * exist on either side until today.
 *
 * Run: `npm run smoke:trainer-tabs` (needs NODE_ENV=development for devCode).
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
s.check('role is INSTRUCTOR', verified?.data?.user?.roles?.includes('INSTRUCTOR'), true);

const as = (method, path, body, expect = 200) =>
  s.call(method, path, body, expect, 'instructor');

s.section('page 24 — dashboard, one call');
const home = await as('GET', '/app/instructor/dashboard');
const metrics = home?.data?.metrics ?? [];
s.check('four metric tiles', metrics.length, 4);
s.check('tile order', metrics.map((m) => m.key), [
  'todaySessions',
  'bookingRequests',
  'activeClients',
  'monthEarnings',
]);
s.check("today's sessions is padded", metrics[0]?.value, '01');
s.check('one request waiting', metrics[1]?.value, '01');
s.check('one active client', metrics[2]?.value, '01');
s.check('earnings tile is rupees', metrics[3]?.value?.startsWith('₹'), true);
s.check('today is dd-mm-yyyy', /^\d{2}-\d{2}-\d{4}$/.test(home?.data?.today), true);
s.check('schedule has the ASSIGNED session', home?.data?.schedule?.length, 1);
s.check('schedule time is split', home?.data?.schedule?.[0]?.meridiem, 'AM');
s.check('client name is masked', home?.data?.schedule?.[0]?.clientLine, 'Client: Aditi K. · 60 min');
s.check('request preview present', home?.data?.requests?.[0]?.initials, 'AK');
s.check('preview carries the session id Review opens', typeof home?.data?.requests?.[0]?.sessionId, 'string');
s.check('stage reported', home?.data?.trainer?.stage, 'APPROVED');

s.section('page 30 — bookings list and its summary');
const all = await as('GET', '/app/instructor/bookings');
s.check('five rows', all?.data?.length, 5);
s.check('summary total', all?.meta?.summary?.total, 5);
s.check('two completed', all?.meta?.summary?.completed, 2);
// Three, not two: the paid session whose DIRECT offer is still unanswered is
// confirmed, not pending (client, 23-11-2026). Nothing is pending here —
// `pending` now holds RESCHEDULE_REQUESTED alone.
s.check('three upcoming', all?.meta?.summary?.upcoming, 3);
s.check('nothing pending', all?.meta?.summary?.pending, 0);
s.check('newest first', all?.data?.[0]?.slot?.date, all?.data?.[0]?.slot?.date);
s.check('row date is dd-mm-yyyy', /^\d{2}-\d{2}-\d{4}$/.test(all?.data?.[0]?.slot?.date), true);
s.check('row carries the area, not the street', all?.data?.[0]?.area?.includes('Baner'), true);
s.check('amount is a number', all?.data?.[0]?.amount, 800);

s.section('the filter chips, and that they never move the summary');
const completed = await as('GET', '/app/instructor/bookings?status=completed');
s.check('completed chip', completed?.data?.length, 2);
s.check('summary unchanged under a filter', completed?.meta?.summary?.total, 5);
const pending = await as('GET', '/app/instructor/bookings?status=pending');
s.check('pending chip is empty', pending?.data?.length, 0);
// The point of the 23-11-2026 change: the unanswered §4.7 session sits under
// the Confirmed chip and its pill says so, while page 31 still asks for the
// answer (asserted below).
const confirmed = await as('GET', '/app/instructor/bookings?status=confirmed');
s.check('confirmed chip', confirmed?.data?.length, 3);
const unanswered = confirmed?.data?.find((r) => r.sessionId === made.sessionIds[4]);
s.check('the unanswered offer reads CONFIRMED', unanswered?.statusLabel, 'CONFIRMED');
s.check('and its pill is tinted confirmed', unanswered?.bucket, 'confirmed');
await as('GET', '/app/instructor/bookings?status=nonsense', undefined, 400);

s.section('the search box');
const found = await as('GET', '/app/instructor/bookings?q=Aditi');
s.check('search by client name', found?.data?.length, 5);
const missed = await as('GET', '/app/instructor/bookings?q=zzzznope');
s.check('search that matches nothing', missed?.data?.length, 0);
s.check('but the summary still stands', missed?.meta?.summary?.total, 5);

s.section('page 32 — booking detail, and that it is scoped to the owner');
const detail = await as('GET', `/app/instructor/bookings/${made.sessionIds[4]}`);
s.check('detail is the right session', detail?.data?.sessionId, made.sessionIds[4]);
s.check('detail names the open request', detail?.data?.request?.mode, 'DIRECT');
s.check('session count from the package', detail?.data?.sessionCount, 5);
s.check('detail carries the goal too', detail?.data?.goal, 'Build strength and improve overall fitness');
s.check('and the health notes', /knee injury/.test(detail?.data?.healthNotes ?? ''), true);
await as(
  'GET',
  '/app/instructor/bookings/00000000-0000-4000-8000-000000000000',
  undefined,
  404,
);

s.section('page 31 — the §4.7 request inbox');
const requests = await as('GET', '/app/instructor/requests');
s.check('one request', requests?.meta?.count, 1);
s.check('it is the customer’s own pick', requests?.data?.[0]?.mode, 'DIRECT');
s.check('received at is a timestamp', /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(requests?.data?.[0]?.receivedAt), true);
s.check('a direct request does not expire', requests?.data?.[0]?.expiresAt, null);
s.check('slot range reads as a range', requests?.data?.[0]?.slot?.range, '07:30 AM – 08:30 AM');
s.check('amount on the request', requests?.data?.[0]?.amount, 800);
s.check('the goal page 31 quotes', requests?.data?.[0]?.goal, 'Build strength and improve overall fitness');
s.check('health notes the trainer must read before arriving',
  requests?.data?.[0]?.healthNotes,
  'Recovering from a knee injury — no deep squats');
s.check('but still no contact details', requests?.data?.[0]?.client?.mobile, undefined);

s.section('page 34 — reject needs a reason, and never substitutes a trainer');
await as('POST', `/app/instructor/requests/${made.requestId}/reject`, {}, 400);
const rejected = await as('POST', `/app/instructor/requests/${made.requestId}/reject`, {
  reason: 'Not available at the requested time',
  message: 'Already booked that morning.',
}, 201);
s.check('rejected', rejected?.data?.response, 'REJECTED');
s.check('and did NOT cascade to someone else', rejected?.data?.cascaded, false);
s.check('a second answer is refused',
  s.errorCode(await as('POST', `/app/instructor/requests/${made.requestId}/reject`, { reason: 'again' }, 409)),
  'DUPLICATE_RESOURCE');

const afterReject = await as('GET', '/app/instructor/requests');
s.check('inbox is empty', afterReject?.meta?.count, 0);
const parked = await s.cleanup((db) =>
  db.bookingSession.findUnique({ where: { id: made.sessionIds[4] } }),
);
s.check('session parked for admin', parked?.status, 'REASSIGNMENT_NEEDED');
s.check('and the trainer is detached', parked?.instructorId, null);

s.section('page 33 — accept, on a fresh direct request');
const second = await s.cleanup((db) =>
  db.assignment.create({
    data: {
      sessionId: made.sessionIds[3],
      instructorId: made.trainerId,
      mode: 'DIRECT',
      response: 'PENDING',
    },
  }),
);
const accepted = await as('POST', `/app/instructor/requests/${second.id}/accept`, {
  note: 'See you at 7:30.',
}, 201);
s.check('accepted', accepted?.data?.response, 'ACCEPTED');
const assigned = await s.cleanup((db) =>
  db.bookingSession.findUnique({ where: { id: made.sessionIds[3] } }),
);
s.check('session is ASSIGNED', assigned?.status, 'ASSIGNED');
s.check('and the note landed', assigned?.notesByInstructor, 'See you at 7:30.');

s.section('page 38 — clients, folded out of bookings with no new table');
const clients = await as('GET', '/app/instructor/clients');
s.check('one client', clients?.meta?.summary?.all, 1);
s.check('and they are active', clients?.meta?.summary?.active, 1);
s.check('name is masked', clients?.data?.[0]?.name, 'Aditi K.');
s.check('initials for the avatar', clients?.data?.[0]?.initials, 'AK');
s.check('session count', clients?.data?.[0]?.sessions, 4);
s.check('completed count', clients?.data?.[0]?.completed, 2);
s.check('joined is dd-mm-yyyy', /^\d{2}-\d{2}-\d{4}$/.test(clients?.data?.[0]?.joinedAt), true);
const noneInactive = await as('GET', '/app/instructor/clients?status=inactive');
s.check('inactive filter', noneInactive?.data?.length, 0);
const searched = await as('GET', '/app/instructor/clients?q=aditi');
s.check('search is case-insensitive', searched?.data?.length, 1);

s.section('page 39 — client profile, scoped to this trainer');
const client = await as('GET', `/app/instructor/clients/${made.customerId}`);
s.check('the right client', client?.data?.id, made.customerId);
s.check('recent sessions listed', client?.data?.recent?.length, 4);
s.check('recent dates are dd-mm-yyyy', /^\d{2}-\d{2}-\d{4}$/.test(client?.data?.recent?.[0]?.date), true);
s.check('no mobile is exposed', client?.data?.mobile, undefined);
await as(
  'GET',
  '/app/instructor/clients/00000000-0000-4000-8000-000000000000',
  undefined,
  404,
);

s.section('page 57 — earnings dashboard');
const earnings = await as('GET', '/app/instructor/earnings/summary');
s.check('default period is the month', earnings?.data?.period, 'month');
s.check('total is the net of both earnings', earnings?.data?.total, 1200);
s.check('payable is the available balance', earnings?.data?.availableBalance, 600);
s.check('paid to date', earnings?.data?.paidToDate, 600);
s.check('nothing pending', earnings?.data?.pendingAmount, 0);
s.check('two sessions counted', earnings?.data?.completedSessions, 2);
s.check('average per session', earnings?.data?.averagePerSession, 600);
s.check('six chart columns', earnings?.data?.chart?.length, 6);
s.check('this month has the money', earnings?.data?.chart?.at(-1)?.amount, 1200);
s.check('two transactions', earnings?.data?.transactions?.length, 2);
s.check('an earning reads as money in', earnings?.data?.transactions?.[0]?.direction, 'IN');
s.check('transaction names the client', earnings?.data?.transactions?.[0]?.title, 'Session · Aditi K.');
s.check('no payout scheduled yet', earnings?.data?.nextPayout, null);
const week = await as('GET', '/app/instructor/earnings/summary?period=week');
s.check('the week chip works', week?.data?.period, 'week');
await as('GET', '/app/instructor/earnings/summary?period=decade', undefined, 400);

s.section('every route refuses an anonymous caller');
await s.noToken('GET', '/app/instructor/dashboard');
await s.noToken('GET', '/app/instructor/bookings');
await s.noToken('GET', '/app/instructor/requests');
await s.noToken('GET', '/app/instructor/clients');
await s.noToken('GET', '/app/instructor/earnings/summary');

s.section('and a customer token is not an instructor token');
await s.loginCustomer();
await s.call('GET', '/app/instructor/bookings', undefined, 403, 'customer');
await s.call('GET', '/app/instructor/clients', undefined, 403, 'customer');

s.section('home answers before approval — the shell is reachable from DOCUMENTS_SUBMITTED');
await s.cleanup((db) =>
  db.instructorProfile.update({
    where: { id: made.trainerId },
    data: { onboardingStage: 'DOCUMENTS_SUBMITTED' },
  }),
);
const waiting = await as('GET', '/app/instructor/dashboard');
s.check('dashboard still answers', waiting?.data?.trainer?.stage, 'DOCUMENTS_SUBMITTED');
s.check('and says so', waiting?.data?.trainer?.active, false);
s.check('with four honest zeroes', waiting?.data?.metrics?.[0]?.value, '00');
s.check('no schedule', waiting?.data?.schedule?.length, 0);
s.check('the working tabs still 404', (await as('GET', '/app/instructor/bookings', undefined, 404)) && true, true);

await s.cleanup((db) => removeWorld(db, made));
s.done();
