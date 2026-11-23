/**
 * How many history rows the admin View dialog used to repeat, and how many
 * entries it shows after the 23-11-2026 collapse. Read-only.
 *
 *   node -r dotenv/config test/probe-admin-history.mjs
 *
 * Same grouping key as `admin-booking-detail.view.ts`: a change is the
 * transition, the actor, the reason and the second it happened in.
 */
const { PrismaClient } = await import('../dist/generated/prisma/client.js');
const { PrismaPg } = await import('@prisma/adapter-pg');

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const busiest = await db.bookingStatusHistory.groupBy({
  by: ['bookingId'],
  _count: { _all: true },
  orderBy: { _count: { bookingId: 'desc' } },
  take: 5,
});

for (const row of busiest) {
  const rows = await db.bookingStatusHistory.findMany({
    where: { bookingId: row.bookingId },
    select: {
      fromStatus: true,
      toStatus: true,
      actorType: true,
      actorId: true,
      reason: true,
      createdAt: true,
    },
  });

  const entries = new Set(
    rows.map((r) =>
      [
        r.fromStatus ?? '—',
        r.toStatus,
        r.actorType,
        r.actorId ?? '—',
        r.reason ?? '—',
        Math.floor(r.createdAt.getTime() / 1000),
      ].join('|'),
    ),
  );

  console.log(
    `booking ${row.bookingId?.slice(0, 8)}: ${row._count._all} rows -> ${entries.size} entries`,
  );
}

await db.$disconnect();
