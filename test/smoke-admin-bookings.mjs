/**
 * Smoke test for `/admin/bookings/*` (PDF 6.6), against the real server and
 * database. A green build does not prove a Prisma query — this drives one.
 *
 * Read-only by design: it exercises list, every filter, and detail. It does
 * **not** call cancel, because that would destroy real dev bookings; the
 * cancel path's guard (everything already terminal → 409) is the one branch
 * left for a manual check.
 *
 *   npm run build && node -r dotenv/config dist/main.js &
 *   npm run smoke:admin-bookings
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();

await s.withAdmin(async () => {
  // The list, with its joins — customer -> user, service, sessions ->
  // instructor. This is the query a bad `where` or `select` would throw on.
  const list = await s.call('GET', '/admin/bookings?limit=5');
  s.check('rows is an array', Array.isArray(list?.data), true);
  s.check('meta has a page', typeof list?.meta?.page, 'number');

  // Every filter, because each builds a different `where`.
  for (const status of [
    'PENDING_PAYMENT',
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED_BY_ADMIN',
  ]) {
    await s.call('GET', `/admin/bookings?status=${status}&limit=1`);
  }

  for (const paid of ['UNPAID', 'PAID', 'REFUNDED', 'FAILED']) {
    await s.call('GET', `/admin/bookings?paymentStatus=${paid}&limit=1`);
  }

  await s.call('GET', '/admin/bookings?q=HF&limit=1');

  // Rejected by the DTO rather than ignored.
  await s.call('GET', '/admin/bookings?status=NOT_A_STATUS', undefined, 400);

  const first = list?.data?.[0];

  if (first) {
    const detail = await s.call('GET', `/admin/bookings/${first.id}`);
    s.check('detail has sessions', Array.isArray(detail?.data?.sessions), true);
    s.check('detail has statusHistory', Array.isArray(detail?.data?.statusHistory), true);
    s.check('detail has payments', Array.isArray(detail?.data?.payments), true);
    s.check('detail joins the customer', typeof detail?.data?.customer?.name, 'string');
  } else {
    console.log('note: no bookings in this database — detail not exercised');
  }

  // A missing booking is a 404, not a 500.
  await s.call(
    'GET',
    '/admin/bookings/00000000-0000-4000-8000-000000000000',
    undefined,
    404,
  );
});

await s.noToken('GET', '/admin/bookings');

s.done();
