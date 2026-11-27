/**
 * Page 24's booking-request cards — **one card per booking, with the
 * sessions under it** (client, 27-11-2026).
 *
 * An offer is made per session, so a package used to draw one identical
 * "New client request" card per session. This suite gives the fixture
 * trainer two pending offers on the *same* booking and asserts the home
 * screen answers one card, named after the client, carrying both sessions.
 *
 * Run: `npm run smoke:trainer-home-requests` (needs NODE_ENV=development).
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

// The fixture offers session 5 (day +6). A second offer on session 4
// (day +4) is the same booking, so the two must fold into one card.
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

s.section('two pending offers on one booking answer as one card');
const home = await as('GET', '/app/instructor/dashboard');
const cards = home?.data?.requests ?? [];
s.check('one card, not one per session', cards.length, 1);
s.check('headed by the client, masked', cards[0]?.title, 'Aditi K.');
s.check(
  'the line under it is unchanged',
  cards[0]?.subtitle,
  `From Aditi K. · Personal Training ${stamp}`,
);
s.check('initials still there for the avatar', cards[0]?.initials, 'AK');
s.check('the booking is the card', cards[0]?.id, made.bookingId);
s.check('and it says how many sessions', cards[0]?.sessionCount, 2);

s.section('the sessions under the arrow');
const sessions = cards[0]?.sessions ?? [];
s.check('both sessions listed', sessions.length, 2);
s.check('soonest first', sessions[0]?.sessionId, made.sessionIds[3]);
s.check('then the later one', sessions[1]?.sessionId, made.sessionIds[4]);
s.check('each row carries its own offer', sessions[0]?.requestId, second.id);
s.check('the other row the fixture offer', sessions[1]?.requestId, made.requestId);
s.check(
  'date is dd-mm-yyyy',
  /^\d{2}-\d{2}-\d{4}$/.test(sessions[0]?.slot?.date),
  true,
);
s.check('range reads as a range', sessions[0]?.slot?.range, '07:30 AM – 08:30 AM');
s.check('the service is named on the row', sessions[0]?.service, `Personal Training ${stamp}`);
s.check(
  'the card still carries a session for Review',
  sessions.some((row) => row.sessionId === cards[0]?.sessionId),
  true,
);

s.section('the tile counts bookings, not sessions');
const tile = (home?.data?.metrics ?? []).find((m) => m.key === 'bookingRequests');
s.check('one booking request waiting', tile?.value, '01');

await s.noToken('GET', '/app/instructor/dashboard');

await s.cleanup((db) => removeWorld(db, made));
s.done();
