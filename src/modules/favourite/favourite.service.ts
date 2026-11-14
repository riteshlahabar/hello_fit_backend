import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { toProviderCard, type CardRow } from '../provider-search/provider-card';
import { FavouriteRepository } from './favourite.repository';

/**
 * Saved trainers — the website's Saved Trainers page.
 *
 * Client instruction, 13 Nov 2026; **not in the v3 PDF** (open-points.md).
 * The heart on the search card has existed since the design arrived and did
 * nothing but raise a toast; this is what it writes to.
 *
 * Two rules worth stating because neither is obvious from the page:
 *
 *   * **A saved provider who stops being public stops being listed.** Not
 *     deleted — listed. The row survives so that if they are reinstated the
 *     customer has not silently lost their list.
 *   * **Only a public provider can be saved**, so the heart cannot be used to
 *     probe for suspended or unapproved people by id.
 */
@Injectable()
export class FavouriteService {
  constructor(private readonly repo: FavouriteRepository) {}

  async list(userId: string) {
    const customerId = await this.requireCustomer(userId);
    const rows = await this.repo.listForCustomer(customerId);

    return rows.map((row) => ({
      ...toProviderCard(row.instructor as unknown as CardRow),
      savedAt: row.createdAt,
    }));
  }

  /** The ids, so the search page can draw its hearts filled. */
  async ids(userId: string) {
    const customerId = await this.requireCustomer(userId);
    return this.repo.idsForCustomer(customerId);
  }

  async add(userId: string, instructorId: string) {
    const customerId = await this.requireCustomer(userId);
    const provider = await this.repo.publicInstructor(instructorId);

    // The same 404 a non-public provider gets from the detail route, for the
    // same reason: this must not become a way to discover who is suspended.
    if (!provider) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Provider not found',
      });
    }

    await this.repo.add(customerId, instructorId);

    return { instructorId, name: provider.name, saved: true };
  }

  async remove(userId: string, instructorId: string) {
    const customerId = await this.requireCustomer(userId);
    await this.repo.remove(customerId, instructorId);

    // Idempotent: removing something already gone is the outcome the caller
    // wanted. A 404 here would make an un-save fail after a double tap.
    return { instructorId, saved: false };
  }

  async count(userId: string) {
    const customerId = await this.requireCustomer(userId);
    return this.repo.countForCustomer(customerId);
  }

  private async requireCustomer(userId: string) {
    const customer = await this.repo.customerByUserId(userId);

    if (!customer) {
      throw new BadRequestException({
        code: ErrorCode.PROFILE_REQUIRED,
        message: 'Complete your profile first',
      });
    }

    return customer.id;
  }
}
