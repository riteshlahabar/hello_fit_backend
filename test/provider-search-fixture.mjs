/**
 * A provider the search suite fully controls — city, area, category, service,
 * account and profile — so it can be walked through every visibility state
 * without touching seeded data.
 *
 * Same shape as `admin-fixture.mjs` and `serviceability-fixture.mjs`: created
 * and torn down by id, nothing left behind.
 *
 * Built straight through Prisma rather than the API because there is no
 * endpoint that creates a provider with KYC already verified — onboarding is a
 * multi-stage workflow with document uploads, and driving it here would test
 * `instructor/` rather than the search.
 */

/**
 * @type {(db: any, stamp: string) => Promise<{
 *   userId: string, providerId: string, serviceId: string,
 *   categoryId: string, areaId: string, cityId: string }>}
 */
export async function createProvider(db, stamp) {
  const city = await db.city.create({
    data: { name: `Searchville ${stamp}`, state: 'Maharashtra' },
  });

  const area = await db.serviceArea.create({
    data: { cityId: city.id, name: `Central ${stamp}` },
  });

  const category = await db.serviceCategory.create({
    data: { name: `Aerial ${stamp}`, slug: `aerial-${stamp}`, sortOrder: 99 },
  });

  const service = await db.service.create({
    data: {
      categoryId: category.id,
      name: `Aerial Hoop ${stamp}`,
      slug: `aerial-hoop-${stamp}`,
      durationMin: 60,
      basePrice: 900,
    },
  });

  const user = await db.user.create({
    data: { mobile: `7${stamp}${stamp.slice(0, 3)}`.slice(0, 10), status: 'ACTIVE' },
  });

  const provider = await db.instructorProfile.create({
    data: {
      userId: user.id,
      name: `Smoke Provider ${stamp}`,
      experienceYears: 9,
      specialisations: ['Aerial'],
      sessionFormats: ['CUSTOMER_HOME', 'ONLINE'],
      ratingAvg: 4.9,
      ratingCount: 12,
      status: 'ACTIVE',
      kycStatus: 'VERIFIED',
      // Active but NOT approved: the suite's first assertion is that this
      // state is invisible, so approval has to be the administrator's doing.
      instructorServices: {
        create: { serviceId: service.id, customPrice: 850, isActive: true },
      },
      instructorServiceAreas: { create: { areaId: area.id } },
    },
  });

  return {
    userId: user.id,
    providerId: provider.id,
    serviceId: service.id,
    categoryId: category.id,
    areaId: area.id,
    cityId: city.id,
  };
}

/** Removes everything `createProvider` made, children first. */
export async function removeProvider(db, made) {
  await db.instructorServiceArea.deleteMany({ where: { instructorId: made.providerId } });
  await db.instructorService.deleteMany({ where: { instructorId: made.providerId } });
  await db.instructorProfile.deleteMany({ where: { id: made.providerId } });
  await db.user.deleteMany({ where: { id: made.userId } });
  await db.service.deleteMany({ where: { id: made.serviceId } });
  await db.serviceCategory.deleteMany({ where: { id: made.categoryId } });
  await db.serviceArea.deleteMany({ where: { id: made.areaId } });
  await db.city.deleteMany({ where: { id: made.cityId } });
}
