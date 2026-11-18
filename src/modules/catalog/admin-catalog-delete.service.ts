import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AdminActor } from './admin-catalog.service';

/**
 * Deleting a catalogue row (client instruction, 18 Nov 2026).
 *
 * **Hard delete, refused when anything points at the row.** The client asked
 * for the row to be gone rather than hidden, and for the refusal to name what
 * is holding it so the administrator can clear that first. Nothing is
 * cascaded: a booking, a session, an invoice or a provider link is never
 * removed to make a delete succeed.
 *
 * Until now the whole catalogue was delete-free by design — a package left
 * through its status route and a service through visibility. Those routes
 * stay: hiding is still the right move for a row with history.
 */
@Injectable()
export class AdminCatalogDeleteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async deleteCategory(id: string, actor: AdminActor) {
    const row = await this.prisma.serviceCategory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, _count: { select: { services: true } } },
    });

    this.found(row, 'Category');
    this.refuseIfHeld(row.name, [['service', row._count.services]]);

    await this.prisma.serviceCategory.delete({ where: { id } });
    await this.record(actor, 'catalog.category_deleted', 'ServiceCategory', id, row.name);

    return { id, name: row.name };
  }

  async deleteService(id: string, actor: AdminActor) {
    const row = await this.prisma.service.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            bookings: true,
            sessions: true,
            instructorServices: true,
            commissionRules: true,
          },
        },
      },
    });

    this.found(row, 'Service');
    this.refuseIfHeld(row.name, [
      ['booking', row._count.bookings],
      ['session', row._count.sessions],
      ['trainer link', row._count.instructorServices],
      ['commission rule', row._count.commissionRules],
    ]);

    await this.prisma.service.delete({ where: { id } });
    await this.record(actor, 'catalog.service_deleted', 'Service', id, row.name);

    return { id, name: row.name };
  }

  async deletePackage(id: string, actor: AdminActor) {
    const row = await this.prisma.package.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, _count: { select: { bookings: true } } },
    });

    this.found(row, 'Package');
    this.refuseIfHeld(row.name, [['booking', row._count.bookings]]);

    await this.prisma.package.delete({ where: { id } });
    await this.record(actor, 'catalog.package_deleted', 'Package', id, row.name);

    return { id, name: row.name };
  }


  private found<T>(row: T | null, label: string): asserts row is T {
    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: `${label} not found`,
      });
    }
  }

  /**
   * The refusal names every holder and its count, because "cannot delete" on
   * its own leaves the administrator guessing which screen to visit.
   */
  private refuseIfHeld(name: string, holders: Array<[string, number]>) {
    const held = holders.filter(([, count]) => count > 0);

    if (held.length === 0) return;

    const parts = held.map(
      ([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`,
    );

    throw new ConflictException({
      code: ErrorCode.FOREIGN_KEY_VIOLATION,
      message: `"${name}" still has ${parts.join(', ')}. Delete ${held.length === 1 ? 'those' : 'them'} first, or hide this row instead.`,
    });
  }

  private record(
    actor: AdminActor,
    action: string,
    entityType: string,
    entityId: string,
    name: string,
  ) {
    return this.audit.record({
      adminUserId: actor.adminUserId,
      action,
      entityType,
      entityId,
      before: { name },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });
  }
}
