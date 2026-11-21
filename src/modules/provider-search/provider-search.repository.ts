import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PUBLIC_OFFERING, PUBLIC_PROVIDER } from './provider-visibility';
import type { Prisma } from '../../generated/prisma/client';
import type { SearchProvidersQueryDto } from './dto/provider-search.dto';

/** Fields the result card and the profile header both need. */
const CARD_SELECT = {
  id: true,
  name: true,
  photoUrl: true,
  bio: true,
  experienceYears: true,
  languages: true,
  specialisations: true,
  ratingAvg: true,
  ratingCount: true,
} satisfies Prisma.InstructorProfileSelect;

const OFFERING_SELECT = {
  id: true,
  level: true,
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
} satisfies Prisma.InstructorServiceSelect;

/**
 * Prisma queries for the public provider search. No business rules here — the
 * visibility rule lives in `provider-visibility.ts` and is composed in.
 */
@Injectable()
export class ProviderSearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Translates the sidebar into a `where`.
   *
   * The service, category and price filters all land on
   * `instructorServices.some`, and they are deliberately in the **same**
   * `some` rather than one each: a provider who teaches Yoga at ₹2000 and
   * Pilates at ₹400 must not match "Yoga under ₹500" by satisfying each half
   * with a different service.
   */
  private where(query: SearchProvidersQueryDto): Prisma.InstructorProfileWhereInput {
    const offering = this.offeringWhere(query, { withPrice: true });

    return {
      ...PUBLIC_PROVIDER,
      instructorServices: { some: offering },

      ...(query.minRating ? { ratingAvg: { gte: query.minRating } } : {}),

      ...(query.areaId || query.cityId
        ? {
            instructorServiceAreas: {
              some: {
                ...(query.areaId ? { areaId: query.areaId } : {}),
                area: {
                  isActive: true,
                  deletedAt: null,
                  ...(query.cityId ? { cityId: query.cityId } : {}),
                },
              },
            },
          }
        : {}),

      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { specialisations: { has: query.q } },
            ],
          }
        : {}),
    };
  }

  private orderBy(sort?: string): Prisma.InstructorProfileOrderByWithRelationInput[] {
    if (sort === 'experience') return [{ experienceYears: 'desc' }, { ratingAvg: 'desc' }];
    // `price` cannot be ordered on here — it lives on the offerings, not the
    // provider — so it is sorted in the service after the cheapest offering
    // of each row is known. Rating is the default and the fallback.
    return [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }];
  }

  async search(query: SearchProvidersQueryDto, skip: number, take: number) {
    const where = this.where(query);

    const [rows, total] = await Promise.all([
      this.prisma.instructorProfile.findMany({
        where,
        select: {
          ...CARD_SELECT,
          instructorServices: {
            where: this.offeringWhere(query, { withPrice: false }),
            select: OFFERING_SELECT,
          },
        },
        orderBy: this.orderBy(query.sort),
        skip,
        take,
      }),
      this.prisma.instructorProfile.count({ where }),
    ]);

    return { rows, total };
  }

  /**
   * The one offering filter, used twice.
   *
   * `where` composes it under `instructorServices.some` to decide **which
   * providers** match; `search` reuses it to decide **which of a matching
   * provider's offerings** travel back on the row, so a card that matched
   * "Yoga under ₹500" lists the Yoga offering rather than everything the
   * provider teaches.
   *
   * `withPrice` is the only difference between the two: the ceiling belongs
   * in the match, but clipping the returned offerings by price would hide the
   * rate the card then prints.
   */
  private offeringWhere(
    query: SearchProvidersQueryDto,
    options: { withPrice: boolean },
  ): Prisma.InstructorServiceWhereInput {
    const offering: Prisma.InstructorServiceWhereInput = { ...PUBLIC_OFFERING };

    // The service wins over the category when both arrive: it is the narrower
    // of the two and the booking flow's own filter.
    if (query.serviceId) {
      offering.serviceId = query.serviceId;
    } else if (query.categoryId?.length) {
      offering.service = {
        ...(offering.service as object),
        categoryId: { in: query.categoryId },
      };
    }

    if (options.withPrice && query.maxPrice !== undefined) {
      // One price per service now that providers no longer set their own
      // (client, 17 Nov 2026), so the ceiling has a single column to hit.
      offering.service = {
        ...(offering.service as object),
        basePrice: { lte: query.maxPrice },
      };
    }

    return offering;
  }

  findOne(id: string) {
    return this.prisma.instructorProfile.findFirst({
      where: { id, ...PUBLIC_PROVIDER },
      select: {
        ...CARD_SELECT,
        instructorServices: { where: PUBLIC_OFFERING, select: OFFERING_SELECT },
        instructorServiceAreas: {
          where: { area: { isActive: true, deletedAt: null } },
          select: {
            area: {
              select: {
                id: true,
                name: true,
                city: { select: { id: true, name: true, state: true } },
              },
            },
          },
        },
      },
    });
  }
}
