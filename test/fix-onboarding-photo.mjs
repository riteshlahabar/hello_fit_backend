/**
 * Drops `PHOTO` from `app_settings.onboarding.requiredDocuments` (client,
 * 26-11-2026 — page 16 must not ask for a photo page 12 already took).
 *
 * That change was made in `settings.defaults.ts` only, and `seedSettings()`
 * upserts with `update: {}` so it never overwrites a tuned value — so on every
 * database already seeded, PHOTO stayed required. `canSubmitForReview` and
 * `canApprove` both read this list, so onboarding dead-ended: the screen no
 * longer offers a photo and approval refused with "Upload these documents:
 * PHOTO". Run once per environment, including the VPS. Idempotent.
 */
const { PrismaClient } = await import('../dist/generated/prisma/client.js');
const { PrismaPg } = await import('@prisma/adapter-pg');

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const row = await db.appSetting.findUnique({ where: { key: 'onboarding' } });

if (!row) {
  console.log('no onboarding override — defaults already apply, nothing to do');
} else {
  const before = row.value.requiredDocuments ?? [];
  const after = before.filter((d) => d !== 'PHOTO');

  if (before.length === after.length) {
    console.log('PHOTO already absent:', after.join(', '));
  } else {
    await db.appSetting.update({
      where: { key: 'onboarding' },
      data: { value: { ...row.value, requiredDocuments: after } },
    });
    console.log('requiredDocuments:', before.join(', '), '->', after.join(', '));
  }
}

await db.$disconnect();
