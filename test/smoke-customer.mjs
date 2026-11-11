/**
 * End-to-end smoke test for the profile + address endpoints, against the real
 * server and the real database.
 *
 * What it proves: a customer can now go from "never seen before" to "has a
 * saved address" entirely through the API. Before this module the address had
 * to be inserted by hand, which is why the test fixtures did exactly that.
 */
// Overridable so the suite can run against a second build while a dev
// server already holds 3000.
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1';
const mobile = '9' + String(Date.now()).slice(-9);

let token = '';
let pass = 0;
let fail = 0;

async function call(method, path, body, expect = 200) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  if (ok) pass += 1;
  else fail += 1;
  const label = `${ok ? 'PASS' : 'FAIL'}  ${method} ${path}`;
  console.log(
    `${label.padEnd(56)} ${res.status}${ok ? '' : ` (wanted ${expect})`}` +
      (ok ? '' : `  ${JSON.stringify(json).slice(0, 200)}`),
  );
  return json;
}

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    ((ok ? 'PASS  ' : 'FAIL  ') + label).padEnd(56) +
      ` ${JSON.stringify(actual)}${ok ? '' : ` (wanted ${JSON.stringify(expected)})`}`,
  );
}

// ---------------------------------------------------------------- 1. sign in
console.log('\n--- OTP login, brand-new mobile ---');
const send = await call('POST', '/auth/otp/send', { mobile });
const devCode = send?.data?.devCode;
if (!devCode) {
  console.error('no devCode — NODE_ENV must be development for this test');
  process.exit(1);
}
const verify = await call('POST', '/auth/otp/verify', { mobile, code: devCode });
token = verify?.data?.accessToken ?? '';
check('got an access token', token.length > 20, true);
check('flagged as a new account', verify?.data?.user?.isNewAccount, true);

// --------------------------------------------------------------- 2. profile
console.log('\n--- profile: auto-created at signup, completed by PATCH ---');
const blank = await call('GET', '/app/customer/profile');
check('name starts empty', blank?.data?.name, '');
check('isComplete starts false', blank?.data?.isComplete, false);

const code = blank?.data?.referralCode ?? '';
console.log(`      referral code issued: ${code}`);
check(
  'referral code uses the unambiguous alphabet',
  /^HF[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/.test(code),
  true,
);

await call('PATCH', '/app/customer/profile', {
  name: 'Smoke Test',
  gender: 'FEMALE',
  goal: 'Flexibility',
  dob: '1994-03-11',
});
const filled = await call('GET', '/app/customer/profile');
check('isComplete after PATCH', filled?.data?.isComplete, true);
check(
  'dob stored as the same calendar day',
  String(filled?.data?.dob).slice(0, 10),
  '1994-03-11',
);

// ------------------------------------------------------------- 3. addresses
console.log('\n--- addresses ---');
await call('GET', '/app/customer/addresses');

const a1 = await call('POST', '/app/customer/addresses', {
  label: 'Home',
  line1: '12 Karve Road',
  landmark: 'Near Karishma Chowk',
  pincode: '411029',
  lat: 18.5074,
  lng: 73.8077,
  accessNotes: 'Second floor, ring twice',
}, 201);
const first = a1?.data?.id;
check('first address becomes the default', a1?.data?.isDefault, true);

const a2 = await call('POST', '/app/customer/addresses', {
  label: 'Office',
  line1: '7 Indraprastha Chambers',
  pincode: '411004',
}, 201);
const second = a2?.data?.id;
check('second address is not default', a2?.data?.isDefault, false);

await call('POST', `/app/customer/addresses/${second}/default`);
const listed = await call('GET', '/app/customer/addresses');
const defaults = (listed?.data ?? []).filter((a) => a.isDefault);
check('exactly one default after switching', defaults.length, 1);
check('the switch moved it to Office', defaults[0]?.label, 'Office');

await call('PATCH', `/app/customer/addresses/${first}`, { label: 'Home (new)' });
const fetched = await call('GET', `/app/customer/addresses/${first}`);
check('patch persisted', fetched?.data?.label, 'Home (new)');

// ------------------------------------------------- 4. validation + ownership
console.log('\n--- validation and ownership ---');
await call('POST', '/app/customer/addresses', { label: 'x', line1: 'x', pincode: '12' }, 400);
await call(
  'POST',
  '/app/customer/addresses',
  { label: 'x', line1: 'A valid line', pincode: '011029' },
  400,
);
await call('GET', '/app/customer/addresses/not-a-uuid', null, 400);
await call('GET', '/app/customer/addresses/11111111-1111-4111-8111-111111111111', null, 404);
await call(
  'PATCH',
  '/app/customer/addresses/11111111-1111-4111-8111-111111111111',
  { label: 'nope' },
  404,
);
// Referral: wrong shape, then well-formed but unknown.
await call('PATCH', '/app/customer/profile', { referredByCode: 'HF0OO000' }, 400);
await call('PATCH', '/app/customer/profile', { referredByCode: 'HF234567' }, 400);

console.log('\n--- unauthenticated access is refused ---');
const savedToken = token;
token = '';
await call('GET', '/app/customer/addresses', null, 401);
token = savedToken;

// ------------------------------------------------------------- 5. referral
console.log('\n--- a real referral code resolves, and only once ---');
const other = '9' + String(Date.now() - 12_345).slice(-9);
const s2 = await call('POST', '/auth/otp/send', { mobile: other });
const v2 = await call('POST', '/auth/otp/verify', {
  mobile: other,
  code: s2?.data?.devCode,
});
token = v2?.data?.accessToken ?? '';
const referred = await call('PATCH', '/app/customer/profile', {
  name: 'Referred Friend',
  referredByCode: code,
});
check('referral recorded', Boolean(referred?.data?.referredById), true);
await call('PATCH', '/app/customer/profile', { referredByCode: code }, 409);
token = savedToken;

// --------------------------------------------------------------- 6. delete
console.log('\n--- delete promotes a new default ---');
await call('DELETE', `/app/customer/addresses/${second}`);
const remaining = (await call('GET', '/app/customer/addresses'))?.data ?? [];
check('one address left', remaining.length, 1);
check('it was promoted to default', remaining[0]?.isDefault, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
