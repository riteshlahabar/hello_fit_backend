/**
 * Smoke test for `/admin/catalog/*` (PDF 6.5), against the real server and
 * database. A green build does not prove a Prisma query — this drives one.
 *
 * Creates one throwaway category and removes it at the end. The service half
 * is read-only plus a visibility flip that is flipped straight back, so no
 * real catalogue row is left changed.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { withTemporaryAdmin } from './admin-fixture.mjs';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1';
const STAMP = Date.now();
let token = '';
let pass = 0;
let fail = 0;

async function call(method, path, body, expect = 200) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.status === expect;
  ok ? (pass += 1) : (fail += 1);
  if (!ok) {
    console.log(`FAIL  ${method} ${path} -> ${res.status} (wanted ${expect})`);
    console.log(`      ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json;
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? (pass += 1) : (fail += 1);
  if (!ok) console.log(`FAIL  ${label}: ${JSON.stringify(actual)} (wanted ${JSON.stringify(expected)})`);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
let categoryId = '';

try {
  await withTemporaryAdmin(async (fx) => {
    const login = await fetch(`${BASE}/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: fx.email, password: fx.password }),
    }).then((r) => r.json());
    token = login?.data?.accessToken ?? '';
    check('admin token', token.length > 20, true);

    const list = await call('GET', '/admin/catalog/categories?limit=5');
    check('categories is an array', Array.isArray(list?.data), true);
    check('service count is joined in', typeof list?.data?.[0]?._count?.services, 'number');

    // 201, Nest's default for a POST that creates.
    const created = await call('POST', '/admin/catalog/categories', {
      name: `Smoke Category ${STAMP}`,
      description: 'Created by smoke:admin-catalog.',
      sortOrder: 99,
    }, 201);
    categoryId = created?.data?.id ?? '';
    check('slug derived from the name', created?.data?.slug, `smoke-category-${STAMP}`);
    check('starts active', created?.data?.isActive, true);

    // Same name twice is a 409, not a second row.
    await call('POST', '/admin/catalog/categories', { name: `Smoke Category ${STAMP}` }, 409);

    const renamed = await call('PATCH', `/admin/catalog/categories/${categoryId}`, {
      name: `Smoke Renamed ${STAMP}`,
      description: 'Edited.',
    });
    check('rename re-derives the slug', renamed?.data?.slug, `smoke-renamed-${STAMP}`);

    const off = await call('PATCH', `/admin/catalog/categories/${categoryId}`, { isActive: false });
    check('deactivated', off?.data?.isActive, false);

    // Inactive rows are hidden unless asked for.
    const def = await call('GET', `/admin/catalog/categories?q=Smoke Renamed ${STAMP}`);
    check('hidden by default', def?.data?.length, 0);
    const all = await call('GET', `/admin/catalog/categories?q=Smoke Renamed ${STAMP}&includeInactive=true`);
    check('shown with includeInactive', all?.data?.length, 1);

    // There is no delete route — 6.5 does not grant one.
    await call('DELETE', `/admin/catalog/categories/${categoryId}`, null, 404);

    // Services: review, filter, and the one visibility lever.
    const services = await call('GET', '/admin/catalog/services?limit=5');
    check('services is an array', Array.isArray(services?.data), true);
    const svc = services?.data?.[0];
    if (svc) {
      check('category is joined in', typeof svc?.category?.name, 'string');
      await call('GET', `/admin/catalog/services?categoryId=${svc.categoryId}&limit=1`);
      const hidden = await call('POST', `/admin/catalog/services/${svc.id}/visibility`, { isActive: false });
      check('hidden', hidden?.data?.isActive, false);
      check('booked-session count reported', typeof hidden?.data?.upcomingBookings, 'number');
      const shown = await call('POST', `/admin/catalog/services/${svc.id}/visibility`, { isActive: true });
      check('restored', shown?.data?.isActive, true);
    } else {
      console.log('note: no services in this database — visibility not exercised');
    }

    // There is no GET /services/:id — 6.5 asks for review, not a detail page.
    await call('GET', '/admin/catalog/services/not-a-uuid', null, 404);
    // A malformed id on the one route that takes one is a 400 from ParseUUIDPipe.
    await call('POST', '/admin/catalog/services/not-a-uuid/visibility', { isActive: true }, 400);
  });
} finally {
  if (categoryId) {
    await prisma.serviceCategory.delete({ where: { id: categoryId } }).catch(() => {});
  }
  await prisma.$disconnect();
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
