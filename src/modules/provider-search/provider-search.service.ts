import { Injectable, NotFoundException } from '@nestjs/common';
import { ProviderSearchRepository } from './provider-search.repository';
import { ErrorCode } from '../../common/errors/error-codes';
import type { SearchProvidersQueryDto } from './dto/provider-search.dto';

const DEFAULT_LIMIT = 12;

type Offering = {
  id: string;
  level: string;
  customPrice: unknown;
  service: {
    id: string;
    name: string;
    slug: string;
    durationMin: number;
    basePrice: unknown;
    category: { id: string; name: string; slug: string } | null;
  };
};

/** The price a customer would actually pay: the provider's, else the service's. */
const priceOf = (offering: Offering): number =>
  Number(offering.customPrice ?? offering.service.basePrice);

/**
 * Public provider search and profiles — PDF §5.5 and §5.6.
 *
 * Nothing here scores or ranks providers *for* the customer. That is what
 * `assignment/` does and it is the opposite model: the v3 PDF is a
 * marketplace, so this returns a filtered, sorted list and the customer
 * chooses (§3.6). `assignment/` stays for the auto-assign path the apps still
 * use and is not touched.
 */
@Injectable()
export class ProviderSearchService {
  constructor(private readonly repo: ProviderSearchRepository) {}

  async search(query: SearchProvidersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const { rows, total } = await this.repo.search(query, (page - 1) * limit, limit);

    const cards = rows.map((row) => {
      const offerings = row.instructorServices as unknown as Offering[];
      const prices = offerings.map(priceOf);

      return {
        id: row.id,
        name: row.name,
        photoUrl: row.photoUrl,
        headline: row.bio,
        experienceYears: row.experienceYears,
        languages: row.languages,
        specialisations: row.specialisations,
        sessionFormats: row.sessionFormats,
        rating: Number(row.ratingAvg),
        ratingCount: row.ratingCount,
        /** The design's card shows one "from ₹X" figure. */
        fromPrice: prices.length ? Math.min(...prices) : null,
        /** The pill on the photo is a category name. */
        categories: [
          ...new Map(
            offerings
              .map((o) => o.service.category)
              .filter((c): c is NonNullable<typeof c> => Boolean(c))
              .map((c) => [c.id, c]),
          ).values(),
        ],
        serviceCount: offerings.length,
      };
    });

    // `price` is sorted here, not in SQL: the figure is the cheapest of each
    // provider's matching offerings, which is not a column. Sorting the page
    // rather than the whole set is a known limitation — stated plainly instead
    // of pretending the order is global.
    if (query.sort === 'price') {
      cards.sort((a, b) => (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity));
    }

    return {
      rows: cards,
      meta: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        /** §5.5: "appropriate messaging appears when there are no results." */
        empty: total === 0,
        priceSortIsPageOnly: query.sort === 'price',
      },
    };
  }

  async get(id: string) {
    const row = await this.repo.findOne(id);

    // The same 404 whether the provider does not exist or is not public, so
    // the endpoint cannot be used to discover suspended or unapproved people.
    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Provider not found',
      });
    }

    const offerings = row.instructorServices as unknown as Offering[];

    return {
      id: row.id,
      name: row.name,
      photoUrl: row.photoUrl,
      bio: row.bio,
      experienceYears: row.experienceYears,
      languages: row.languages,
      specialisations: row.specialisations,
      sessionFormats: row.sessionFormats,
      rating: Number(row.ratingAvg),
      ratingCount: row.ratingCount,
      services: offerings.map((o) => ({
        id: o.service.id,
        offeringId: o.id,
        name: o.service.name,
        slug: o.service.slug,
        durationMin: o.service.durationMin,
        level: o.level,
        price: priceOf(o),
        category: o.service.category,
      })),
      areas: row.instructorServiceAreas.map((link) => ({
        id: link.area.id,
        name: link.area.name,
        city: link.area.city,
      })),
    };
  }
}
