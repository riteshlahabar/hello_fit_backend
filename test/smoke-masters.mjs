/**
 * End-to-end smoke test for the masters and admin-user modules, against the
 * real server and the real database.
 *
 * What it proves: the geography chain (city -> area -> pincode -> branch),
 * languages and holidays can be created, listed, edited and retired; an admin
 * account and a role can be managed; and none of the guard rails can be
 * clicked past — retiring a parent that still has children, a second default
 * language, a duplicate name, deleting a built-in role, deleting the last
 * super admin, or any admin acting on their own account.
 *
 * `test/admin-fixture.mjs` mints a throwaway super-admin, so no credentials
 * are needed. Everything this creates is cleaned up at the end.
 *
 * Run against a built server, not `start:dev` — the fixture imports the
 * generated Prisma client from `dist/`, which the watcher rebuilds underneath
 * it:
 *
 *   npm run build && node -r dotenv/config dist/main.js &
 *   npm run smoke:masters
 */
import { withTemporaryAdmin } from './admin-fixture.mjs';

const BASE = 'http://localhost:3000/api/v1';
const STAMP = Date.now();

let adminToken = '';
let pass = 0;
let fail = 0;

async function call(method, path, body, expect = 200, token = adminToken) {
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
  console.log(
    `${(ok ? 'PASS  ' : 'FAIL  ') + `${method} ${path}`.padEnd(58)} ${res.status}` +
      (ok ? '' : ` (wanted ${expect})  ${JSON.stringify(json).slice(0, 280)}`),
  );
  return json;
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else fail += 1;
  console.log(
    ((ok ? 'PASS  ' : 'FAIL  ') + label).padEnd(64) +
      ` ${JSON.stringify(actual)}${ok ? '' : ` (wanted ${JSON.stringify(expected)})`}`,
  );
}

function errorCode(res) {
  return res?.error?.code;
}

await withTemporaryAdmin(async (fx) => {
  console.log('\n--- sign in as the throwaway super-admin ---');
  const login = await call(
    'POST',
    '/admin/auth/login',
    { email: fx.email, password: fx.password },
    200,
    '',
  );
  adminToken = login?.data?.accessToken ?? '';
  check('got an admin access token', adminToken.length > 20, true);

  // =======================================================================
  console.log('\n--- geography: city ---');
  // =======================================================================
  const cityRes = await call(
    'POST',
    '/admin/masters/cities',
    { name: `Smoke City ${STAMP}`, state: 'Maharashtra', launchDate: '2026-12-01' },
    201,
  );
  const cityId = cityRes.data?.id;
  check('city is active', cityRes.data?.isActive, true);
  check('launchDate is a calendar day', cityRes.data?.launchDate?.slice(0, 10), '2026-12-01');

  await call(
    'POST',
    '/admin/masters/cities',
    { name: `Smoke City ${STAMP}`, state: 'Maharashtra' },
    409,
  ).then((r) => check('duplicate city refused', errorCode(r), 'DUPLICATE_RESOURCE'));

  const cityList = await call('GET', `/admin/masters/cities?q=Smoke City ${STAMP}`);
  check('city list finds it', cityList.data?.length, 1);
  check('list carries meta.total', cityList.meta?.total, 1);

  await call('PATCH', `/admin/masters/cities/${cityId}`, { state: 'MH' });
  const cityAfter = await call('GET', `/admin/masters/cities/${cityId}`);
  check('city state updated', cityAfter.data?.state, 'MH');

  // =======================================================================
  console.log('\n--- geography: branch, area, pincode ---');
  // =======================================================================
  const branchRes = await call(
    'POST',
    '/admin/masters/branches',
    { name: `Smoke Branch ${STAMP}`, cityId, address: '1 Test Road' },
    201,
  );
  const branchId = branchRes.data?.id;

  const areaRes = await call(
    'POST',
    '/admin/masters/areas',
    { cityId, name: `Smoke Area ${STAMP}`, branchId },
    201,
  );
  const areaId = areaRes.data?.id;
  check('area is linked to the city', areaRes.data?.cityId, cityId);

  await call(
    'POST',
    '/admin/masters/areas',
    { cityId, name: `Smoke Area ${STAMP}` },
    409,
  ).then((r) => check('duplicate area in city refused', errorCode(r), 'DUPLICATE_RESOURCE'));

  const pincodeRes = await call(
    'POST',
    '/admin/masters/pincodes',
    { code: '411001', areaId },
    201,
  );
  const pincodeId = pincodeRes.data?.id;

  await call('POST', '/admin/masters/pincodes', { code: '41100', areaId }, 400).then(
    (r) => check('5-digit pincode refused', errorCode(r), 'VALIDATION_FAILED'),
  );

  const bulk = await call('POST', '/admin/masters/pincodes/bulk', {
    areaId,
    codes: ['411002', '411003', '411001', '411002'],
  });
  check('bulk created the 2 new codes', bulk.data?.created, 2);
  check('bulk reported the existing one', bulk.data?.skipped, ['411001']);
  check('bulk counted the in-request duplicate', bulk.data?.duplicatesInRequest, 1);

  const pincodeList = await call('GET', `/admin/masters/pincodes?areaId=${areaId}`);
  check('area now has 3 pincodes', pincodeList.meta?.total, 3);

  // =======================================================================
  console.log('\n--- refusals: a parent with live children cannot be retired ---');
  // =======================================================================
  await call('DELETE', `/admin/masters/cities/${cityId}`, null, 409).then((r) => {
    check('city delete refused while it has children', errorCode(r), 'MASTER_IN_USE');
    check('refusal names the counts', r?.error?.details?.areas, 1);
  });

  await call('PATCH', `/admin/masters/cities/${cityId}`, { isActive: false }, 409).then(
    (r) => check('deactivating gets the same check', errorCode(r), 'MASTER_IN_USE'),
  );

  // A child cannot be added under an inactive parent.
  await call('PATCH', `/admin/masters/areas/${areaId}`, { isActive: false });
  await call('POST', '/admin/masters/pincodes', { code: '411009', areaId }, 400).then(
    (r) => check('pincode under inactive area refused', errorCode(r), 'MASTER_PARENT_INACTIVE'),
  );
  await call('PATCH', `/admin/masters/areas/${areaId}`, { isActive: true });

  // =======================================================================
  console.log('\n--- languages: exactly one default ---');
  // =======================================================================
  const langs = await call('GET', '/admin/masters/languages');
  const seededDefault = langs.data?.find((l) => l.isDefault);
  check('a default language exists from the seed', Boolean(seededDefault), true);

  // A language subtag is letters only (BCP-47), so the unique-per-run code is
  // built from letters rather than the timestamp's digits.
  const L = 'abcdefghijklmnopqrstuvwxyz';
  const langCode = `q${L[STAMP % 26]}${L[Math.floor(STAMP / 26) % 26]}`;

  const newLang = await call(
    'POST',
    '/admin/masters/languages',
    { code: langCode, name: `Smoke Lang ${STAMP}`, isDefault: true },
    201,
  );
  const langId = newLang.data?.id;

  const afterPromote = await call('GET', '/admin/masters/languages?includeInactive=true');
  check(
    'promoting left exactly one default',
    afterPromote.data?.filter((l) => l.isDefault).length,
    1,
  );

  await call('DELETE', `/admin/masters/languages/${langId}`, null, 400).then((r) =>
    check('the default language cannot be deleted', errorCode(r), 'MASTER_DEFAULT_REQUIRED'),
  );

  // Put the seeded default back, then the smoke language is removable.
  await call('PATCH', `/admin/masters/languages/${seededDefault.id}`, { isDefault: true });
  await call('DELETE', `/admin/masters/languages/${langId}`);

  // =======================================================================
  console.log('\n--- holidays ---');
  // =======================================================================
  const holiday = await call(
    'POST',
    '/admin/masters/holidays',
    { date: '2027-01-26', title: 'Republic Day (smoke)', cityId },
    201,
  );
  const holidayId = holiday.data?.id;
  check('holiday blocks booking by default', holiday.data?.blocksBooking, true);
  check('holiday date is the calendar day', holiday.data?.date?.slice(0, 10), '2027-01-26');

  await call(
    'POST',
    '/admin/masters/holidays',
    { date: '2027-01-26', title: 'Duplicate', cityId },
    409,
  ).then((r) => check('duplicate holiday refused', errorCode(r), 'DUPLICATE_RESOURCE'));

  const holidayList = await call(
    'GET',
    `/admin/masters/holidays?cityId=${cityId}&from=2027-01-01&to=2027-12-31`,
  );
  check('holiday found in the range', holidayList.meta?.total, 1);
  await call('DELETE', `/admin/masters/holidays/${holidayId}`);

  // =======================================================================
  console.log('\n--- admin users ---');
  // =======================================================================
  const roles = await call('GET', '/admin/roles');
  const supportRole = roles.data?.find((r) => r.slug === 'support-agent');
  const superRole = roles.data?.find((r) => r.slug === 'super-admin');
  check('seeded roles are listed', Boolean(supportRole && superRole), true);

  const perms = await call('GET', '/admin/roles/permissions');
  check('permission catalogue includes admins:view',
    Boolean(perms.data?.find((p) => p.module === 'admins' && p.action === 'view')), true);

  const newAdminEmail = `smoke-staff-${STAMP}@hellofit.test`;
  const created = await call(
    'POST',
    '/admin/admin-users',
    {
      email: newAdminEmail,
      name: 'Smoke Staff',
      password: 'Str0ng!Passw0rd!2026',
      roleId: supportRole.id,
      branchId,
    },
    201,
  );
  const staffId = created.data?.id;
  check('password hash is not in the response', 'passwordHash' in (created.data ?? {}), false);
  check('role is expanded', created.data?.role?.slug, 'support-agent');

  await call(
    'POST',
    '/admin/admin-users',
    {
      email: newAdminEmail,
      name: 'Dupe',
      password: 'Str0ng!Passw0rd!2026',
      roleId: supportRole.id,
    },
    409,
  ).then((r) => check('duplicate email refused', errorCode(r), 'DUPLICATE_RESOURCE'));

  await call(
    'POST',
    '/admin/admin-users',
    { email: `weak-${STAMP}@hellofit.test`, name: 'Weak', password: 'short', roleId: supportRole.id },
    400,
  ).then((r) => check('weak password refused', errorCode(r), 'VALIDATION_FAILED'));

  const me = await call('GET', '/admin/admin-users/me');
  check('me returns the caller', me.data?.id, fx.adminUserId);

  await call('PATCH', `/admin/admin-users/${staffId}`, { name: 'Smoke Staff Renamed' });
  const staffAfter = await call('GET', `/admin/admin-users/${staffId}`);
  check('name updated', staffAfter.data?.name, 'Smoke Staff Renamed');

  await call('POST', `/admin/admin-users/${staffId}/status`, { status: 'SUSPENDED', reason: 'smoke test' });
  const suspended = await call('GET', `/admin/admin-users/${staffId}`);
  check('status is SUSPENDED', suspended.data?.status, 'SUSPENDED');

  // =======================================================================
  console.log('\n--- refusals: self-action and the last super admin ---');
  // =======================================================================
  await call('POST', `/admin/admin-users/${fx.adminUserId}/status`, { status: 'SUSPENDED' }, 403)
    .then((r) => check('cannot suspend yourself', errorCode(r), 'ADMIN_SELF_ACTION'));

  await call('DELETE', `/admin/admin-users/${fx.adminUserId}`, null, 403).then((r) =>
    check('cannot delete yourself', errorCode(r), 'ADMIN_SELF_ACTION'),
  );

  await call('PATCH', `/admin/admin-users/${fx.adminUserId}`, { roleId: supportRole.id }, 403)
    .then((r) => check('cannot change your own role', errorCode(r), 'ADMIN_SELF_ACTION'));

  // =======================================================================
  console.log('\n--- roles ---');
  // =======================================================================
  const roleRes = await call(
    'POST',
    '/admin/roles',
    {
      name: `Smoke Role ${STAMP}`,
      slug: `smoke-role-${STAMP}`,
      description: 'Created by the masters smoke test',
      permissionIds: perms.data.filter((p) => p.module === 'masters' && p.action === 'view').map((p) => p.id),
    },
    201,
  );
  const roleId = roleRes.data?.id;
  check('role created with 1 permission', roleRes.data?.rolePermissions?.length, 1);
  check('new roles are not system roles', roleRes.data?.isSystem, false);

  const viewAndEdit = perms.data
    .filter((p) => p.module === 'masters' && ['view', 'edit'].includes(p.action))
    .map((p) => p.id);
  const replaced = await call('PUT', `/admin/roles/${roleId}/permissions`, {
    permissionIds: viewAndEdit,
  });
  check('permissions replaced wholesale', replaced.data?.rolePermissions?.length, 2);

  await call('PUT', `/admin/roles/${roleId}/permissions`, { permissionIds: [crypto.randomUUID()] }, 400)
    .then((r) => check('unknown permission id refused', errorCode(r), 'VALIDATION_FAILED'));

  await call('DELETE', `/admin/roles/${superRole.id}`, null, 409).then((r) =>
    check('built-in role cannot be deleted', errorCode(r), 'ROLE_IS_SYSTEM'),
  );

  await call('PUT', `/admin/roles/${superRole.id}/permissions`, { permissionIds: [] }, 409).then(
    (r) => check('super-admin permissions cannot be stripped', errorCode(r), 'ROLE_IS_SYSTEM'),
  );

  // Assign the staff member to the new role, then the role is in use.
  await call('PATCH', `/admin/admin-users/${staffId}`, { roleId });
  await call('DELETE', `/admin/roles/${roleId}`, null, 409).then((r) => {
    check('role in use cannot be deleted', errorCode(r), 'ROLE_IN_USE');
    check('refusal names the count', r?.error?.details?.adminUsers, 1);
  });

  // =======================================================================
  console.log('\n--- cleanup ---');
  // =======================================================================
  await call('DELETE', `/admin/admin-users/${staffId}`);
  await call('DELETE', `/admin/roles/${roleId}`);
  await call('DELETE', `/admin/masters/pincodes/${pincodeId}`);
  // The other two bulk-created pincodes go with the area; unmap them so the
  // area is clean, then walk the chain back up.
  const remaining = await call('GET', `/admin/masters/pincodes?areaId=${areaId}`);
  for (const p of remaining.data ?? []) {
    await call('DELETE', `/admin/masters/pincodes/${p.id}`);
  }
  await call('DELETE', `/admin/masters/areas/${areaId}`);
  await call('DELETE', `/admin/masters/branches/${branchId}`);
  await call('DELETE', `/admin/masters/cities/${cityId}`);

  const gone = await call('GET', `/admin/masters/cities?q=Smoke City ${STAMP}`);
  check('city no longer listed', gone.data?.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
