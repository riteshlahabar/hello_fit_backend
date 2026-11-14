import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PUBLIC_OFFERING, PUBLIC_PROVIDER } from '../provider-search/provider-visibility';

/**
 * The same fields the search card needs, so both pages render identically.
 * The select is duplicated rather than imported because the search repository
 * keeps its own private; the **mapping** is shared (`provider-card.ts`), which
 * is the part that could drift in a way anyone would notice.
 */
const CARD_SELECT = {
  id: true,
  name: true,
  photoUrl: true,
  bio: true,
  experienceYears: true,
  languages: true,
  specialisations: true,
  sessionFormats: true,
  ratingAvg: true,
  ratingCount: true,
  instructorServices: {
    where: PUBLIC_OFFERING,
    select: {
      id: true,
      level: true,
      customPrice: true,
      service: {
        select: {
          id: true,
          name: true,
          slug: true,
          durationMin: true,
          basePrice: true,
          category: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  },
} satisfies Prisma.InstructorProfileSelect;

@Injectable()
export class FavouriteRepository {
  constructor(private readonly prisma: PrismaService) {}

  customerByUserId(userId: string) {
    return this.prisma.customerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
  }

  /**
   * The saved list, newest first.
   *
   * **Filtered by `PUBLIC_PROVIDER`, exactly as the search is.** A provider
   * who was saved and has since been suspended, had their KYC lapse or had
   * their last offering unapproved must not appear here as bookable — the
   * visibility rule is a safety rule, and a saved page is not an exemption
   * from it. The row stays in the table; it simply stops being shown.
   */
  listForCustomer(customerId: string) {
    return this.prisma.favourite.findMany({
      where: { customerId, instructor: PUBLIC_PROVIDER },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, instructor: { select: CARD_SELECT } },
    });
  }

  /** How many of this customer's saved providers are still public. */
  countForCustomer(customerId: string) {
    return this.prisma.favourite.count({
      where: { customerId, instructor: PUBLIC_PROVIDER },
    });
  }

  /** Only a provider the customer could actually have seen may be saved. */
  publicInstructor(instructorId: string) {
    return this.prisma.instructorProfile.findFirst({
      where: { id: instructorId, ...PUBLIC_PROVIDER },
      select: { id: true, name: true },
    });
  }

  /**
   * Saving twice is the same as saving once. `upsert` on the unique pair, so
   * a double tap on the heart cannot produce a 409 the UI would have to
   * explain.
   */
  add(customerId: string, instructorId: string) {
    return this.prisma.favourite.upsert({
      where: { customerId_instructorId: { customerId, instructorId } },
      create: { customerId, instructorId },
      update: {},
      select: { id: true, createdAt: true },
    });
  }

  /** Removing something already removed is success, not a 404. */
  remove(customerId: string, instructorId: string) {
    return this.prisma.favourite.deleteMany({ where: { customerId, instructorId } });
  }

  /** The ids this customer has saved, for marking hearts on the search page. */
  async idsForCustomer(customerId: string) {
    const rows = await this.prisma.favourite.findMany({
      where: { customerId },
      select: { instructorId: true },
    });

    return rows.map((row) => row.instructorId);
  }
}
