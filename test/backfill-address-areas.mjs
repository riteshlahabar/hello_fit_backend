/**
 * Backfill `Address.areaId` for rows saved before the PIN resolver existed.
 *
 * Every address created through the website or either app took `areaId` from
 * the client, and no client could supply one — so the rows are there with a
 * valid PIN and no area, and `findSlots` answers each of them with `[]`. The
 * resolver fixes new addresses; these are the ones already saved.
 *
 * Dry run by default — prints what it would do and writes nothing:
 *
 *     node -r dotenv/config test/backfill-address-areas.mjs
 *     node -r dotenv/config test/backfill-address-areas.mjs --write
 *
 * Only unambiguous PINs are filled, the same rule the resolver applies: a PIN
 * in two areas is left alone and listed, because picking one would file a
 * customer under teachers they never chose. Re-runnable; it only ever touches
 * rows where `areaId IS NULL`.
 */
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const WRITE = process.argv.includes('--write');

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const orphans = await db.address.findMany({
  where: { deletedAt: null, areaId: null },
  select: { id: true, label: true, pincode: true, cityId: true },
  orderBy: { createdAt: 'asc' },
});

console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} — ${orphans.length} addresses with no service area\n`);

/**
 * @type {{
 *   fill: { address: { id: string, label: string, pincode: string, cityId: string | null },
 *           row: { areaId: string, area: { name: string, cityId: string } } }[],
 *   ambiguous: { address: { label: string, pincode: string }, count: number }[],
 *   unserved: { label: string, pincode: string }[],
 * }}
 */
const plan = { fill: [], ambiguous: [], unserved: [] };

for (const address of orphans) {
  const rows = await db.pincode.findMany({
    where: {
      code: address.pincode,
      isActive: true,
      deletedAt: null,
      area: {
        isActive: true,
        deletedAt: null,
        city: { isActive: true, deletedAt: null },
      },
    },
    select: { areaId: true, area: { select: { name: true, cityId: true } } },
  });

  if (rows.length === 1) {
    plan.fill.push({ address, row: rows[0] });
  } else if (rows.length > 1) {
    plan.ambiguous.push({ address, count: rows.length });
  } else {
    plan.unserved.push(address);
  }
}

for (const { address, row } of plan.fill) {
  console.log(`  FILL  ${address.pincode} ${address.label} -> ${row.area.name}`);
}
for (const { address, count } of plan.ambiguous) {
  console.log(`  SKIP  ${address.pincode} ${address.label} — ${count} areas, needs a human`);
}
for (const address of plan.unserved) {
  console.log(`  LEAVE ${address.pincode} ${address.label} — not in any serviced area`);
}

console.log(
  `\n${plan.fill.length} fillable, ${plan.ambiguous.length} ambiguous, ${plan.unserved.length} genuinely unserved`,
);

if (!WRITE) {
  console.log('\nNothing written. Re-run with --write to apply the FILL rows.');
} else {
  let done = 0;
  for (const { address, row } of plan.fill) {
    await db.address.update({
      where: { id: address.id },
      data: {
        areaId: row.areaId,
        ...(address.cityId ? {} : { cityId: row.area.cityId }),
      },
    });
    done += 1;
  }
  console.log(`\n${done} addresses updated.`);
}

await db.$disconnect();
