import { Injectable, Logger } from '@nestjs/common';
import { InstructorProfileLookup } from './instructor-profile.lookup';
import { setInstructorServices } from './offering-assign';
import { PrismaService } from '../../prisma/prisma.service';
import type { SetOwnServicesDto } from './dto/instructor-offering.dto';

/**
 * The trainer's own service offerings — page 15's second half, where they tick
 * the services inside the categories they picked (client, 26-11-2026).
 *
 * Its own service rather than more of `instructor.service.ts`, which was split
 * by audience and is already at its line budget.
 *
 * **Reading and writing are deliberately asymmetric.** The write replaces the
 * whole set and leaves every row pending (spec 6.3 — ops approves), so the read
 * has to hand back `approved` per row or the screen could not tell the trainer
 * which of their picks are actually live.
 */
@Injectable()
export class InstructorOfferingService {
  private readonly logger = new Logger(InstructorOfferingService.name);

  constructor(
    private readonly lookup: InstructorProfileLookup,
    private readonly prisma: PrismaService,
  ) {}

  /** What this trainer currently offers, with the service and its category. */
  async listOwn(userId: string) {
    const profile = await this.lookup.requireOwn(userId);

    const rows = await this.prisma.instructorService.findMany({
      where: { instructorId: profile.id, isActive: true, deletedAt: null },
      select: {
        id: true,
        approvedAt: true,
        service: {
          select: {
            id: true,
            name: true,
            durationMin: true,
            basePrice: true,
            category: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { service: { name: 'asc' } },
    });

    return rows.map((row) => ({
      id: row.id,
      serviceId: row.service.id,
      name: row.service.name,
      durationMin: row.service.durationMin,
      // A Postgres Decimal leaves Prisma as an object; the apps read money
      // through their own coercion helpers, so hand them a plain string.
      basePrice: row.service.basePrice.toString(),
      categoryId: row.service.category.id,
      categoryName: row.service.category.name,
      /// Null `approvedAt` is the pending state, not an error.
      approved: row.approvedAt !== null,
    }));
  }

  /**
   * Replaces the set. Refused on a rejected application, like every other
   * teacher-side write, and never approves anything — see
   * [setInstructorServices].
   */
  async setOwn(userId: string, dto: SetOwnServicesDto) {
    const profile = await this.lookup.requireOwn(userId);
    this.lookup.assertEditable(profile.onboardingStage);

    await setInstructorServices(this.prisma, profile.id, dto.serviceIds, {
      approve: false,
    });

    this.logger.log(
      `Instructor services set profile=${profile.id} count=${dto.serviceIds.length}`,
    );
    return this.listOwn(userId);
  }
}
