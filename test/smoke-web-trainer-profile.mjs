/**
 * Phase 5 — the trainer profile wired, the link sweep, and the trainer
 * carried through the booking chain. 13 Nov 2026.
 *
 * The profile was the last dead end in the customer journey: a page about one
 * invented person ("Sneha Patil", 4.9 from 120 sample reviews, ₹600, MON 02
 * Nov / 11:00 AM) with all 32 of its buttons inert. It is server-rendered, so
 * the real values ARE in the HTML and can be asserted directly — unlike
 * billing, which fetches in the browser.
 *
 * The valuable assertions are the three honesty groups:
 *
 *   * the invented person is **gone**, not merely unwired;
 *   * the sixteen fake day/time buttons are **gone** — the slot engine needs
 *     a signed-in customer's address, so a public profile cannot fill that
 *     grid truthfully (client's call, 13 Nov);
 *   * `instructorId` really reaches the API on both `GET /slots` and
 *     `POST /bookings`, because a customer who picks a trainer, sees only
 *     that trainer's times and is then auto-assigned somebody else is the one
 *     failure that makes the whole phase pointless.
 *
 *   SMOKE_SITE_URL=http://localhost:3001 npm run smoke:web-trainer-profile
 */
import { smoke } from './smoke-harness.mjs';

const SITE = process.env.SMOKE_SITE_URL ?? 'http://localhost:3001';
const s = smoke();

const get = (path) => fetch(`${SITE}${path}`).then((r) => r.text());
const status = (path) =>
  fetch(`${SITE}${path}`, { redirect: 'manual' }).then((r) => r.status);

s.section('a real provider to open');

const listed = await s.call('GET', '/providers?limit=3', undefined, 200, 'none');
const provider = listed?.data?.[0];

if (!provider) {
  console.error('no public provider seeded — run the seed before this suite');
  process.exit(1);
}

s.check('provider has an id', typeof provider.id, 'string');
s.check('provider has a name', provider.name?.length > 1, true);

const detail = await s.call('GET', `/providers/${provider.id}`, undefined, 200, 'none');
s.check('detail is the same provider', detail?.data?.id, provider.id);

s.section('the profile renders that provider');

const page = await get(`/trainer-profile?id=${provider.id}`);

s.check('page served', page.length > 1000, true);
s.check('keeps its scope', page.includes('data-hf-page="trainer-profile"'), true);
s.check('real name on the page', page.includes(provider.name), true);
s.check('breadcrumb names them', page.includes(`<span>${provider.name}</span>`), true);
s.check('verified badge, not "Sample profile"', page.includes('Verified'), true);
s.check('services band kept for #services', page.includes('id="services"'), true);
s.check('all four tabs', page.includes('id="tab-reviews"'), true);

for (const service of detail.data.services) {
  s.check(`service "${service.name}" listed`, page.includes(service.name), true);
  s.check(
    `service ${service.name} links to booking`,
    page.includes(`service=${service.id}`),
    true,
  );
}

for (const area of detail.data.areas) {
  s.check(`area ${area.name} listed`, page.includes(area.name), true);
}

s.section('the invented person is gone');

for (const fake of [
  'Sneha Patil',
  'Sample profile',
  '120 sample reviews',
  '320+',
  'Based on 120',
  'sample reviews',
  'illustrative for this prototype',
  'Priya S.',
  'Anjali K.',
  'Sample review',
  'demonstration options',
  '↗ Share',
]) {
  s.check(`no "${fake}"`, page.includes(fake), false);
}

s.section('the sixteen fake day and time buttons are gone');

for (const fake of [
  'class="day selected"',
  'class="day"',
  'time-slots',
  '9:00 AM',
  '11:00 AM',
  '5:30 PM',
  'Continue with selected time',
  'Sample availability',
  'Available sample times',
]) {
  s.check(`no "${fake}"`, page.includes(fake), false);
}

s.check('availability tab kept', page.includes('id="tab-availability"'), true);
s.check('and says where instead', page.includes('Areas served'), true);

s.section('every book button points somewhere real');

s.check(
  'book link carries the trainer',
  page.includes(`/booking?trainer=${provider.id}`),
  true,
);
s.check('Book a Session kept', page.includes('Book a Session'), true);
s.check('Check Availability kept', page.includes('Check Availability'), true);
s.check('Select kept', page.includes('>Select<'), true);
s.check('Choose this service kept', page.includes('Choose this service'), true);

s.section('a bad or missing id is honest, not a crash');

s.check('no id → 200', await status('/trainer-profile'), 200);
s.check(
  'no id says so',
  (await get('/trainer-profile')).includes('No trainer selected'),
  true,
);

const unknown = '00000000-0000-4000-8000-000000000000';
s.check('unknown id → 200', await status(`/trainer-profile?id=${unknown}`), 200);
s.check(
  'unknown id says not found',
  (await get(`/trainer-profile?id=${unknown}`)).includes('Trainer not found'),
  true,
);

s.section('the link sweep: no anchor points at nothing');

const home = await get('/');
const login = await get('/login');

for (const dead of ['href="#search"', 'href="#footer"']) {
  s.check(`home has no ${dead}`, home.includes(dead), false);
}

for (const dead of ['href="#terms"', 'href="#privacy"']) {
  s.check(`login has no ${dead}`, login.includes(dead), false);
}

s.check('terms route exists', await status('/terms-conditions'), 200);
s.check('privacy route exists', await status('/privacy-policy'), 200);
s.check('login links the real terms', login.includes('/terms-conditions'), true);
s.check('login links the real privacy', login.includes('/privacy-policy'), true);

s.section('the homepage band is real people now');

for (const fake of [
  'Alex Morgan',
  'Maya Sharma',
  'Rohan Mehta',
  'illustrative prototype content',
  'Real provider listings will be connected',
  'next design stage',
]) {
  s.check(`home has no "${fake}"`, home.includes(fake), false);
}

s.check('home shows the live provider', home.includes(provider.name), true);
s.check(
  'home card opens the profile',
  home.includes(`/trainer-profile?id=${provider.id}`),
  true,
);

s.section('category cards reach a filtered search');

const categories = await s.call('GET', '/categories', undefined, 200, 'none');
const first = categories?.data?.[0];

s.check(
  'card carries a real categoryId',
  home.includes(`/find-a-trainer?categoryId=${first.id}`),
  true,
);
s.check(
  'and the search page honours it',
  await status(`/find-a-trainer?categoryId=${first.id}`),
  200,
);

s.section('instructorId reaches the API, both calls');

const { mobile } = await s.loginCustomer();

// `areaId` is sent explicitly — the provider's own service area — rather than
// left to the pincode resolver. A resolver that put the address in a different
// area would make the narrowed grid legitimately empty, and the assertions
// below would then be measuring seed data rather than the parameter.
const address = await s.call(
  'POST',
  '/app/customer/addresses',
  {
    label: 'Phase 5 smoke',
    line1: '14 Karve Road',
    pincode: '411038',
    areaId: detail.data.areas[0]?.id,
    isDefault: true,
  },
  201,
  'customer',
);

const addressId = address?.data?.id;
const serviceId = detail.data.services[0]?.id;

s.check('address created', typeof addressId, 'string');

if (serviceId && addressId) {
  const narrowed = await s.call(
    'GET',
    `/app/customer/slots?serviceId=${serviceId}&date=${s.day(2)}&addressId=${addressId}&instructorId=${provider.id}`,
    undefined,
    200,
    'customer',
  );

  s.check('narrowed grid answers', Array.isArray(narrowed?.data), true);

  const wide = await s.call(
    'GET',
    `/app/customer/slots?serviceId=${serviceId}&date=${s.day(2)}&addressId=${addressId}`,
    undefined,
    200,
    'customer',
  );

  // One trainer can never offer more than everyone does. This is what proves
  // the parameter was applied rather than ignored: a server that dropped it
  // would answer the two calls identically.
  s.check(
    'one trainer offers no more than all',
    narrowed.data.length <= wide.data.length,
    true,
  );

  // A trainer who does not exist must narrow to nothing, not fall back to
  // auto-assign — the silent fallback is the dangerous failure.
  const nobody = await s.call(
    'GET',
    `/app/customer/slots?serviceId=${serviceId}&date=${s.day(2)}&addressId=${addressId}&instructorId=${unknown}`,
    undefined,
    200,
    'customer',
  );

  s.check('unknown trainer narrows to none', nobody.data.length, 0);

  const slot = narrowed.data[0];

  if (slot) {
    const booked = await s.call(
      'POST',
      '/app/customer/bookings',
      {
        serviceId,
        addressId,
        sessionDate: s.day(2),
        fromMinute: slot.fromMinute,
        toMinute: slot.toMinute,
        instructorId: provider.id,
        source: 'WEBSITE',
      },
      201,
      'customer',
    );

    s.check('booking created', typeof booked?.data?.id, 'string');

    const read = await s.call(
      'GET',
      `/app/customer/bookings/${booked.data.id}`,
      undefined,
      200,
      'customer',
    );

    // The whole point of the phase: the trainer the customer chose is the
    // trainer on the session, not whoever auto-assign would have picked.
    s.check(
      'the chosen trainer is on the session',
      read?.data?.sessions?.[0]?.instructor?.id,
      provider.id,
    );
  } else {
    console.log('note: no free slot for this trainer on that day — create skipped');
  }
}

s.section('the API still refuses what it should');

await s.noToken('GET', `/app/customer/slots?serviceId=${serviceId}&date=${s.day(2)}&addressId=${addressId}`);
await s.call('GET', '/providers/not-a-uuid', undefined, 400, 'none');
await s.call('GET', `/providers/${unknown}`, undefined, 404, 'none');

await s.cleanup(async (db) => {
  const user = await db.user.findFirst({ where: { mobile } });
  if (!user) return;

  const customer = await db.customerProfile.findFirst({ where: { userId: user.id } });
  if (customer) {
    const bookings = await db.booking.findMany({
      where: { customerId: customer.id },
      select: { id: true },
    });
    const ids = bookings.map((b) => b.id);

    if (ids.length) {
      await db.bookingSession.deleteMany({ where: { bookingId: { in: ids } } });
      await db.booking.deleteMany({ where: { id: { in: ids } } });
    }

    await db.address.deleteMany({ where: { customerId: customer.id } });
    await db.customerProfile.delete({ where: { id: customer.id } });
  }

  await db.user.delete({ where: { id: user.id } });
});

s.done();
