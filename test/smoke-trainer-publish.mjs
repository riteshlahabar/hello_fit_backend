/**
 * Approving a trainer publishes them at once (client, 27-11-2026: "after admin
 * approve show immediately trainer on page").
 *
 * The defect this pins: `provider-visibility.ts` demands one **approved**
 * active offering, and page 15 saves a trainer's own picks pending, so an
 * approved trainer stayed invisible on `GET /providers` for ever. What must
 * still hold is spec 6.3 for later additions — a service picked after
 * approval arrives pending and waits for ops.
 */
import { smoke, BASE } from './smoke-harness.mjs';

const t = smoke();
const { call, check, section, withAdmin, loginCustomer } = t;

const stamp = Date.now();
const trainerName = `Publish Smoke ${stamp}`;

const findInSearch = async () => {
  const page = await call('GET', `/providers?q=${encodeURIComponent(trainerName)}`, undefined, 200, 'none');
  return (page?.data ?? []).find((row) => row.name === trainerName);
};

await withAdmin(async () => {
  section('fixtures — one category, two services');

  const category = await call('POST', '/admin/catalog/categories', { name: `Publish Cat ${stamp}` }, 201);
  const categoryId = category?.data?.id;
  check('category created', typeof categoryId, 'string');

  const makeService = async (name) => {
    const created = await call(
      'POST',
      '/admin/catalog/services',
      { categoryId, name, basePrice: 800, durationMin: 60, commissionPct: 20 },
      201,
    );
    return created?.data?.id;
  };
  const serviceA = await makeService(`Publish Service A ${stamp}`);
  const serviceB = await makeService(`Publish Service B ${stamp}`);
  check('two services created', [serviceA, serviceB].every(Boolean), true);

  section('a trainer applies and picks one service');

  const { mobile } = await loginCustomer();
  await call('POST', '/app/instructor/apply', { name: trainerName }, 201, 'customer');

  const relogin = await fetch(`${BASE}/auth/otp/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobile }),
  }).then((r) => r.json());
  const verified = await call('POST', '/auth/otp/verify', { mobile, code: relogin?.data?.devCode }, 200, 'none');
  t.setToken('instructor', verified?.data?.accessToken);

  const picked = await call('PUT', '/app/instructor/services', { serviceIds: [serviceA] }, 200, 'instructor');
  check('one offering', picked?.data?.length, 1);
  check('the trainer cannot approve themselves', picked?.data?.[0]?.approved, false);

  section('pending — and therefore nowhere near the homepage');
  check('not in public search before approval', await findInSearch(), undefined);

  section('the rest of the onboarding gate, as fixtures');

  let instructorId;
  await t.cleanup(async (db) => {
    const user = await db.user.findFirst({ where: { mobile } });
    const profile = await db.instructorProfile.findFirst({ where: { userId: user.id } });
    instructorId = profile.id;

    await db.instructorProfile.update({
      where: { id: profile.id },
      data: {
        bio: 'Smoke trainer for the publish-on-approval check.',
        specialisations: [`Publish Cat ${stamp}`],
        codeOfConductAt: new Date(),
      },
    });

    const docs = ['ID_PROOF', 'ADDRESS_PROOF', 'PAN', 'BANK_DETAILS', 'YOGA_CERTIFICATION', 'POLICE_VERIFICATION'];
    await db.document.createMany({
      data: docs.map((docType) => ({
        ownerType: 'INSTRUCTOR',
        ownerId: profile.id,
        docType,
        fileUrl: `smoke/${stamp}/${docType}.pdf`,
        verifyStatus: 'VERIFIED',
        verifiedAt: new Date(),
      })),
    });
    check('six documents verified', true, true);
  });

  section('approve — one decision, and the trainer is live');

  const moved = await call(
    'POST',
    `/admin/instructors/${instructorId}/stage`,
    { stage: 'APPROVED', reason: 'publish smoke' },
    200,
    'admin',
  );
  check('moved to APPROVED', moved?.data?.onboarding?.stage, 'APPROVED');

  const mine = await call('GET', '/app/instructor/services', undefined, 200, 'instructor');
  check('the pending pick was approved by the approval', mine?.data?.[0]?.approved, true);

  const live = await findInSearch();
  check('in public search immediately after approval', live?.name, trainerName);
  check('and carries the offering they registered with', live?.serviceCount, 1);

  const detail = await call('GET', `/providers/${instructorId}`, undefined, 200, 'none');
  check('the profile page is reachable too', detail?.data?.id, instructorId);

  section('spec 6.3 still governs what a trainer adds later');

  const added = await call('PUT', '/app/instructor/services', { serviceIds: [serviceA, serviceB] }, 200, 'instructor');
  check('the new pick is pending', added?.data?.find((r) => r.serviceId === serviceB)?.approved, false);
  check('the approved one is untouched', added?.data?.find((r) => r.serviceId === serviceA)?.approved, true);

  const stillLive = await findInSearch();
  check('still listed, on the approved service alone', stillLive?.serviceCount, 1);

  section('teardown');
  await t.cleanup(async (db) => {
    const user = await db.user.findFirst({ where: { mobile } });
    await db.document.deleteMany({ where: { ownerType: 'INSTRUCTOR', ownerId: instructorId } });
    await db.instructorService.deleteMany({ where: { instructorId } });
    await db.instructorProfile.delete({ where: { id: instructorId } });
    await db.refreshToken.deleteMany({ where: { userId: user.id } });
    await db.otpRequest.deleteMany({ where: { mobile } });
    await db.customerProfile.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.service.deleteMany({ where: { categoryId } });
    await db.serviceCategory.delete({ where: { id: categoryId } });
    check('fixtures removed', true, true);
  });
});

t.done();
