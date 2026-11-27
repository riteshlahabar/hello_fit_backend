/**
 * Smoke test for `GET /support/contact` (PDF §3.11, §5.11) — the support
 * contact block the customer app's Support tab and the website's contact page
 * both read. Contact-only, by the client's answer of 27-11-2026: there is no
 * inquiry module and nothing here writes.
 *
 *   npm run build && node -r dotenv/config dist/main.js &
 *   npm run smoke:support
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

const PATH = '/support/contact';

// Public on purpose: a customer who cannot sign in is exactly the one who
// needs the helpline. So, unlike every other suite, the 401 owed here is the
// opposite assertion — no token must still answer 200.
const anon = await s.call('GET', PATH, undefined, 200, 'none');
s.check('readable with no token', typeof anon?.data, 'object');

s.section('the five fields');

const { data } = anon;

for (const field of ['phone', 'whatsapp', 'email', 'hours', 'address']) {
  s.check(
    `${field} is a string or null`,
    data[field] === null || typeof data[field] === 'string',
    true,
  );
}

// A blank setting is sent as null, never as '' — the app hides a row it has
// no value for, and that rule lives in one place.
for (const [field, value] of Object.entries(data)) {
  s.check(`${field} is never blank-as-empty-string`, value !== '', true);
}

s.check('phone is set', typeof data.phone, 'string');
s.check('email is set', typeof data.email, 'string');
s.check('email looks like one', /.+@.+\..+/.test(data.email ?? ''), true);

s.section('signed in reads the same block');

// Same values for a signed-in customer: this is one configured block, not a
// per-account one, and a difference between the two would mean the Support
// tab says something the website does not.
await s.loginCustomer();
const signedIn = await s.call('GET', PATH);
s.check(
  'identical for a signed-in customer',
  JSON.stringify(signedIn?.data),
  JSON.stringify(data),
);

s.section('it is read-only');

// §3.11's inquiry half is deliberately absent, so the routes that would carry
// it must not exist. A 404 here is the assertion, not a gap.
await s.call('POST', PATH, { phone: '0' }, 404);
await s.call('POST', '/support/inquiries', { message: 'hello' }, 404);

s.done();
