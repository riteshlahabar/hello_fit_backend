/**
 * Trainer-app onboarding fields added 19 Nov 2026: the postal address and
 * professional-background columns on `InstructorProfile`, the email that goes
 * to `User`, and the new `instructor_bank_accounts` table behind
 * `/app/instructor/bank-account`.
 *
 * Run: `npm run smoke:trainer-profile` (needs NODE_ENV=development for devCode).
 */
import { smoke } from './smoke-harness.mjs';

const s = smoke();
const { mobile } = await s.loginCustomer();
const email = `trainer.${Date.now()}@hellofit.test`;

s.section('apply, then re-login so the token carries INSTRUCTOR');
await s.call('POST', '/app/instructor/apply', { name: 'Bank Smoke' }, 201, 'customer');

const sent = await s.call('POST', '/auth/otp/send', { mobile }, 200, 'none');
const verified = await s.call(
  'POST',
  '/auth/otp/verify',
  { mobile, code: sent?.data?.devCode },
  200,
  'none',
);
s.setToken('instructor', verified?.data?.accessToken);
s.check('role granted', verified?.data?.user?.roles?.includes('INSTRUCTOR'), true);

s.section('the new profile columns round-trip');
const saved = await s.call(
  'PATCH',
  '/app/instructor/profile',
  {
    email,
    addressLine: '12 Hill Road, Kothrud',
    landmark: 'Opposite the water tank',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411038',
    country: 'India',
    qualification: 'Certified Personal Trainer',
    institute: 'ACSM',
    clientsTrainedBand: '26-50',
    serviceLocality: 'Kothrud',
    studioName: 'Hill Road Strength',
    studioAddress: '12 Hill Road, ground floor',
  },
  200,
  'instructor',
);
s.check('city stored', saved?.data?.city, 'Pune');
s.check('pincode stored', saved?.data?.pincode, '411038');
s.check('qualification stored', saved?.data?.qualification, 'Certified Personal Trainer');
s.check('band stored', saved?.data?.clientsTrainedBand, '26-50');
s.check('studio stored', saved?.data?.studioName, 'Hill Road Strength');
s.check('locality stored', saved?.data?.serviceLocality, 'Kothrud');
s.check('country defaulted and kept', saved?.data?.country, 'India');

const readBack = await s.call('GET', '/app/instructor/profile', undefined, 200, 'instructor');
s.check('address survives a re-read', readBack?.data?.addressLine, '12 Hill Road, Kothrud');
s.check('landmark survives a re-read', readBack?.data?.landmark, 'Opposite the water tank');

s.section('a blank string clears the column rather than storing ""');
const cleared = await s.call(
  'PATCH',
  '/app/instructor/profile',
  { landmark: '   ' },
  200,
  'instructor',
);
s.check('landmark cleared to null', cleared?.data?.landmark, null);
s.check('city untouched by a partial patch', cleared?.data?.city, 'Pune');

s.section('bad profile values are refused');
for (const [label, body] of [
  ['5-digit pincode', { pincode: '41103' }],
  ['non-numeric pincode', { pincode: 'abc123' }],
  ['malformed email', { email: 'not-an-email' }],
  ['over-long city', { city: 'x'.repeat(130) }],
]) {
  const res = await s.call('PATCH', '/app/instructor/profile', body, 400, 'instructor');
  s.check(`${label} rejected as validation`, s.errorCode(res), 'VALIDATION_FAILED');
}

s.section('bank account: nothing until one is saved');
const empty = await s.call('GET', '/app/instructor/bank-account', undefined, 200, 'instructor');
s.check('no account yet', empty?.data, null);

s.section('bank account: a good BANK body saves and reads back masked');
const bank = {
  payoutMethod: 'BANK',
  holderName: 'Bank Smoke',
  bankName: 'HDFC Bank',
  accountNumber: '50100123456789',
  ifsc: 'hdfc0001234',
  accountType: 'SAVINGS',
};
const put = await s.call('PUT', '/app/instructor/bank-account', bank, 200, 'instructor');
s.check('number is masked on the way out', put?.data?.accountNumberMasked, '••••6789');
s.check('ifsc upper-cased', put?.data?.ifsc, 'HDFC0001234');
s.check('method recorded', put?.data?.payoutMethod, 'BANK');
s.check('a fresh account is unverified', put?.data?.verified, false);
s.check('full number never leaves the server', put?.data?.accountNumber, undefined);
// Hard rule 4: every date on the wire reads dd-mm-yyyy.
s.check(
  'updatedAt is dd-mm-yyyy HH:mm:ss',
  /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(put?.data?.updatedAt ?? ''),
  true,
);

const got = await s.call('GET', '/app/instructor/bank-account', undefined, 200, 'instructor');
s.check('reads back', got?.data?.bankName, 'HDFC Bank');

s.section('payout is a radio — the chosen side is compulsory, the other cleared');
const upi = await s.call(
  'PUT',
  '/app/instructor/bank-account',
  { payoutMethod: 'UPI', upiId: 'Bank.Smoke@HDFC' },
  200,
  'instructor',
);
s.check('upi lower-cased', upi?.data?.upiId, 'bank.smoke@hdfc');
s.check('method switched', upi?.data?.payoutMethod, 'UPI');
s.check('stale account number cleared', upi?.data?.accountNumberMasked, null);
s.check('stale ifsc cleared', upi?.data?.ifsc, null);
s.check('stale holder cleared', upi?.data?.holderName, null);

s.section('bank account: bad bodies are refused');
for (const [label, body] of [
  ['short account number', { ...bank, accountNumber: '12345' }],
  ['account number with letters', { ...bank, accountNumber: '5010012345678x' }],
  ['ifsc missing the zero', { ...bank, ifsc: 'HDFCX001234' }],
  ['ifsc too short', { ...bank, ifsc: 'HDFC001' }],
  ['empty holder', { ...bank, holderName: '' }],
  ['no payout method at all', { ...bank, payoutMethod: undefined }],
  ['unknown payout method', { ...bank, payoutMethod: 'CHEQUE' }],
  ['BANK without the bank fields', { payoutMethod: 'BANK' }],
  ['UPI without a upiId', { payoutMethod: 'UPI' }],
  ['UPI with a handle-less id', { payoutMethod: 'UPI', upiId: 'bank.smoke' }],
]) {
  const res = await s.call('PUT', '/app/instructor/bank-account', body, 400, 'instructor');
  s.check(`${label} refused`, s.errorCode(res), 'VALIDATION_FAILED');
}

s.section('a second PUT replaces the row and drops any verification');
await s.cleanup((db) =>
  db.instructorBankAccount.updateMany({ data: { verifiedAt: new Date() } }),
);
const replaced = await s.call(
  'PUT',
  '/app/instructor/bank-account',
  { ...bank, accountNumber: '50100999888777' },
  200,
  'instructor',
);
s.check('new number masked', replaced?.data?.accountNumberMasked, '••••8777');
s.check('verification dropped', replaced?.data?.verified, false);
s.check('upi cleared when the method is BANK', replaced?.data?.upiId, null);

s.section('the routes are shut without a token, and to a customer');
await s.noToken('GET', '/app/instructor/bank-account');
await s.noToken('PUT', '/app/instructor/bank-account', bank);
await s.call('GET', '/app/instructor/bank-account', undefined, 403, 'customer');

await s.cleanup(async (db) => {
  const user = await db.user.findUnique({ where: { mobile } });
  if (user) await db.user.delete({ where: { id: user.id } });
});

s.done();
