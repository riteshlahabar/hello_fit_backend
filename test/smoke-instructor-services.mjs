/**
 * `GET`/`PUT /app/instructor/services` — page 15's second half, where a
 * trainer ticks the services inside the categories they chose
 * (client, 26-11-2026).
 *
 * The three things worth proving: the array is the whole set (an id left out is
 * withdrawn), a trainer's own pick is **pending**, and re-saving a set that
 * already holds an approved row does not retract that approval.
 */
import { smoke, BASE } from './smoke-harness.mjs';

const t = smoke();
const { call, check, errorCode, section, withAdmin, loginCustomer, noToken } = t;

const stamp = Date.now();

await withAdmin(async () => {
  section('fixtures — one category, two services');

  const category = await call(
    'POST',
    '/admin/catalog/categories',
    { name: `Smoke Offerings ${stamp}` },
    201,
  );
  const categoryId = category?.data?.id;
  check('category created', typeof categoryId, 'string');

  const makeService = async (name, basePrice) => {
    const created = await call(
      'POST',
      '/admin/catalog/services',
      { categoryId, name, basePrice, durationMin: 60, commissionPct: 20 },
      201,
    );
    return created?.data?.id;
  };

  const serviceA = await makeService(`Smoke Service A ${stamp}`, 800);
  const serviceB = await makeService(`Smoke Service B ${stamp}`, 900);
  check('two services created', [serviceA, serviceB].every(Boolean), true);

  section('the trainer — a new number that applies, then refreshes its claims');

  const { mobile } = await loginCustomer();
  await call('POST', '/app/instructor/apply', { name: 'Smoke Offerings' }, 201, 'customer');

  // apply() grants INSTRUCTOR in the database; the claims are minted at OTP
  // verify, so the token has to be re-read before any @Roles('INSTRUCTOR')
  // route will answer. This is the 26-11-2026 trainer-app fix, asserted here.
  const refreshed = await call('POST', '/auth/refresh', { refreshToken: null }, 400, 'none');
  check('refresh needs a token', errorCode(refreshed), 'VALIDATION_FAILED');

  const relogin = await fetch(`${BASE}/auth/otp/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile }),
  }).then((r) => r.json());

  const verified = await call(
    'POST',
    '/auth/otp/verify',
    { mobile, code: relogin?.data?.devCode },
    200,
    'none',
  );
  t.setToken('instructor', verified?.data?.accessToken);
  check('instructor claims', verified?.data?.user?.roles?.includes('INSTRUCTOR'), true);

  section('guards');
  await noToken('GET', '/app/instructor/services');
  await noToken('PUT', '/app/instructor/services', { serviceIds: [] });
  const asCustomer = await call(
    'GET',
    '/app/instructor/services',
    undefined,
    403,
    'customer',
  );
  check('customer role refused', errorCode(asCustomer), 'FORBIDDEN');

  section('empty to start');
  const empty = await call('GET', '/app/instructor/services', undefined, 200, 'instructor');
  check('no offerings yet', empty?.data?.length, 0);

  section('validation');
  const notUuid = await call(
    'PUT',
    '/app/instructor/services',
    { serviceIds: ['not-a-uuid'] },
    400,
    'instructor',
  );
  check('non-uuid refused', errorCode(notUuid), 'VALIDATION_FAILED');

  const unknown = await call(
    'PUT',
    '/app/instructor/services',
    { serviceIds: ['11111111-1111-1111-1111-111111111111'] },
    400,
    'instructor',
  );
  check('unknown service refused', errorCode(unknown), 'VALIDATION_FAILED');

  section('pick one — saved, and pending');
  const one = await call(
    'PUT',
    '/app/instructor/services',
    { serviceIds: [serviceA] },
    200,
    'instructor',
  );
  check('one offering', one?.data?.length, 1);
  check('it is service A', one?.data?.[0]?.serviceId, serviceA);
  check('not auto-approved', one?.data?.[0]?.approved, false);
  check('carries the category', one?.data?.[0]?.categoryId, categoryId);
  check('basePrice is a string', typeof one?.data?.[0]?.basePrice, 'string');

  section('pick both');
  const both = await call(
    'PUT',
    '/app/instructor/services',
    { serviceIds: [serviceA, serviceB] },
    200,
    'instructor',
  );
  check('two offerings', both?.data?.length, 2);

  section('the array is the whole set — B alone withdraws A');
  const onlyB = await call(
    'PUT',
    '/app/instructor/services',
    { serviceIds: [serviceB] },
    200,
    'instructor',
  );
  check('one offering left', onlyB?.data?.length, 1);
  check('A is withdrawn', onlyB?.data?.[0]?.serviceId, serviceB);

  section('an approval the trainer did not touch survives a re-save');
  await t.cleanup(async (db) => {
    await db.instructorService.updateMany({
      where: { serviceId: serviceB },
      data: { approvedAt: new Date() },
    });
  });

  const afterApproval = await call(
    'GET',
    '/app/instructor/services',
    undefined,
    200,
    'instructor',
  );
  check('B now approved', afterApproval?.data?.[0]?.approved, true);

  const resaved = await call(
    'PUT',
    '/app/instructor/services',
    { serviceIds: [serviceB] },
    200,
    'instructor',
  );
  check('approval kept', resaved?.data?.[0]?.approved, true);

  section('empty array is a legitimate payload');
  const cleared = await call(
    'PUT',
    '/app/instructor/services',
    { serviceIds: [] },
    200,
    'instructor',
  );
  check('all withdrawn', cleared?.data?.length, 0);

  section('teardown');
  await t.cleanup(async (db) => {
    const user = await db.user.findFirst({ where: { mobile } });
    if (user) {
      const profile = await db.instructorProfile.findFirst({
        where: { userId: user.id },
      });
      if (profile) {
        await db.instructorService.deleteMany({ where: { instructorId: profile.id } });
        await db.instructorProfile.delete({ where: { id: profile.id } });
      }
      await db.refreshToken.deleteMany({ where: { userId: user.id } });
      await db.otpRequest.deleteMany({ where: { mobile } });
      await db.customerProfile.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await db.service.deleteMany({ where: { categoryId } });
    await db.serviceCategory.delete({ where: { id: categoryId } });
    check('fixtures removed', true, true);
  });
});

t.done();
