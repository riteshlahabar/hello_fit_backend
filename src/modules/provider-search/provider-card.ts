/**
 * The shape of one provider card, and the mapping that produces it.
 *
 * Extracted on 13 Nov 2026 when Saved Trainers (Phase 2) needed to render the
 * **same** card as the search results. Two mappings would be two sets of
 * prices: the saved page would quietly keep showing a provider's old figure
 * after they changed it, and nothing would look broken.
 *
 * `provider-search.service` and `favourite.service` both use this.
 */

export type Offering = {
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

export type CardRow = {
  id: string;
  name: string;
  photoUrl: string | null;
  bio: string | null;
  experienceYears: number | null;
  languages: string[];
  specialisations: string[];
  sessionFormats: string[];
  ratingAvg: unknown;
  ratingCount: number;
  instructorServices: unknown;
};

/** The price a customer would actually pay: the provider's, else the service's. */
export const priceOf = (offering: Offering): number =>
  Number(offering.customPrice ?? offering.service.basePrice);

export function toProviderCard(row: CardRow) {
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
}
