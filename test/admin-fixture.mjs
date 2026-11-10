/**
 * Creates a throwaway super-admin for a smoke test, and removes it afterwards.
 *
 * Why this exists: the seed deliberately never resets an existing admin's
 * password, so a smoke test cannot log in as `admin@hellofit.local` without
 * being handed the secret. A disposable account keeps the test runnable by
 * anyone on the team without sharing credentials, and without the test writing
 * to someone's real admin row.
 *
 * Note `AdminUser` is **standalone** — it has no `userId` and no link to
 * `User`; `auth.adminLogin` signs `sub: admin.id`, so the admin token's subject
 * is the `AdminUser.id` itself. Creating one needs nothing but a role.
 *
 * **Refuses to run outside development.** The guard is deliberate: a script
 * that can mint a super-admin must never be runnable against production, and
 * `NODE_ENV` is the same switch that gates the OTP `devCode` the rest of the
 * smoke tests depend on.
 */
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';

export let auditedActions = 0;

/** Audit rows attributed to the temporary admin, counted before it is deleted. */
export function auditedActionCount() {
  return auditedActions;
}

export async function withTemporaryAdmin(run) {
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('withTemporaryAdmin must never run against production');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required — run with -r dotenv/config');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const email = `smoke-admin-${Date.now()}@hellofit.test`;
  const password = `Smoke!${randomUUID()}`;
  let adminUserId;
  auditedActions = 0;

  try {
    const role = await prisma.role.findFirstOrThrow({
      where: { slug: 'super-admin' },
      select: { id: true },
    });

    const admin = await prisma.adminUser.create({
      data: {
        email,
        name: 'Smoke Admin',
        passwordHash: await bcrypt.hash(password, 10),
        roleId: role.id,
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const result = await run({ email, password, adminUserId });

    // Counted *before* the delete below: `AuditLog.adminUserId` is
    // `onDelete: SetNull`, so once this account is gone the rows survive with a
    // null actor and attribution can no longer be checked. This is the only
    // window in which it can be.
    auditedActions = await prisma.auditLog.count({ where: { adminUserId } });

    return result;
  } finally {
    // Hard delete: this account must not linger. Audit rows reference it with
    // onDelete: SetNull, so the trail survives with a null actor — and the
    // refresh tokens it issued go with it.
    if (adminUserId) {
      await prisma.refreshToken
        .deleteMany({ where: { adminUserId } })
        .catch(() => {});
      await prisma.adminUser
        .delete({ where: { id: adminUserId } })
        .catch((e) => console.error('temp admin cleanup failed:', e.message));
    }
    await prisma.$disconnect();
  }
}
