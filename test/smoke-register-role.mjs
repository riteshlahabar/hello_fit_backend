/**
 * Registration lands in the right table (client, 27-11-2026).
 *
 * `POST /auth/otp/verify` now takes `role`. The trainer app sends INSTRUCTOR,
 * so the account must get an `instructor_profiles` row and **no**
 * `customer_profiles` row — a trainer belongs in the admin panel's trainer
 * list, not its customer list. Everything that omits `role` must behave
 * exactly as before.
 */
import { smoke, randomMobile } from './smoke-harness.mjs';

const s = smoke();

const trainerMobile = randomMobile();
const customerMobile = randomMobile();

/** OTP round trip with an explicit role, returning the session user. */
async function register(mobile, role) {
  const sent = await s.call('POST', '/auth/otp/send', { mobile }, 200, 'none');
  const code = sent?.data?.devCode;

  if (!code) {
    console.error('no devCode — NODE_ENV must be development for this test');
    process.exit(1);
  }

  const verified = await s.call(
    'POST',
    '/auth/otp/verify',
    { mobile, code, ...(role ? { role } : {}) },
    200,
    'none',
  );

  return verified?.data;
}

s.section('trainer app registration');

const trainer = await register(trainerMobile, 'INSTRUCTOR');
s.setToken('instructor', trainer?.accessToken);
s.check('roles are INSTRUCTOR only', trainer?.user?.roles, ['INSTRUCTOR']);
s.check('instructor profile made', trainer?.user?.hasInstructorProfile, true);
s.check('no customer profile', trainer?.user?.hasCustomerProfile, false);
s.check('stage is APPLIED', trainer?.user?.instructorOnboardingStage, 'APPLIED');

s.section('customer app registration is unchanged');

const customer = await register(customerMobile, undefined);
s.check('roles are CUSTOMER only', customer?.user?.roles, ['CUSTOMER']);
s.check('customer profile made', customer?.user?.hasCustomerProfile, true);
s.check('no instructor profile', customer?.user?.hasInstructorProfile, false);

s.section('the wizard fills the stub rather than conflicting');

// `apply` used to 409 on any existing profile. The stub registration leaves is
// unnamed, so it must be filled instead — and only once.
const applied = await s.call(
  'POST',
  '/app/instructor/apply',
  { name: 'Smoke Trainer', experienceYears: 3 },
  201,
  'instructor',
);
s.check('name landed', applied?.data?.name, 'Smoke Trainer');

const again = await s.call(
  'POST',
  '/app/instructor/apply',
  { name: 'Second Try' },
  409,
  'instructor',
);
s.check('second apply conflicts', s.errorCode(again), 'APPLICATION_EXISTS');

s.section('one users row, both profiles only when asked');

await s.cleanup(async (db) => {
  const rows = await db.user.findMany({
    where: { mobile: { in: [trainerMobile, customerMobile] } },
    include: {
      customerProfile: { select: { id: true } },
      instructorProfile: { select: { id: true, name: true } },
    },
  });

  s.check('two accounts', rows.length, 2);

  const t = rows.find((r) => r.mobile === trainerMobile);
  s.check('trainer row has instructor profile', Boolean(t?.instructorProfile), true);
  s.check('trainer row has no customer profile', t?.customerProfile, null);
  s.check('trainer profile is named', t?.instructorProfile?.name, 'Smoke Trainer');

  const c = rows.find((r) => r.mobile === customerMobile);
  s.check('customer row has customer profile', Boolean(c?.customerProfile), true);
  s.check('customer row has no instructor profile', c?.instructorProfile, null);

  await db.user.deleteMany({
    where: { mobile: { in: [trainerMobile, customerMobile] } },
  });
});

s.done();
