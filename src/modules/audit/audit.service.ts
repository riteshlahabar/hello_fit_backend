import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export interface AuditEntry {
  /** The admin's `AdminUser.id`, not their `User.id`. Null for a system job. */
  adminUserId: string | null;
  /** Verb in past tense, e.g. `instructor.stage_changed`. */
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ipAddress?: string;
  requestId?: string;
}

/**
 * Writes the before/after trail the spec requires on every admin action
 * (spec 10.1). One service so each admin module does not invent its own shape
 * — finance and support both read this table.
 *
 * **A failed audit write never fails the action.** The alternative is worse: an
 * admin unable to verify a document because the log table is full. The miss is
 * logged at error level instead, where monitoring picks it up.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          adminUserId: entry.adminUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: this.asJson(entry.before),
          after: this.asJson(entry.after),
          reason: entry.reason,
          ipAddress: entry.ipAddress,
          requestId: entry.requestId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Audit write failed for ${entry.action} on ${entry.entityType}:${entry.entityId ?? '-'}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Prisma `Json` columns reject `Record<string, unknown>`, and a `Decimal` or
   * `Date` from a Prisma row is not JSON either — the round-trip normalises
   * both. `undefined` stays undefined so the column is left null.
   */
  private asJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
