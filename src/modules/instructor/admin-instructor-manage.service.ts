import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InstructorRepository } from './instructor.repository';
import { InstructorProfileLookup } from './instructor-profile.lookup';
import { profileDates } from './instructor-view';
import { setOfferingApproval } from './offering-approval';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AdminActor } from './instructor-actor';
import type {
  AdminUpdateInstructorDto,
  ChangeInstructorStatusDto,
} from './dto/admin-instructor.dto';

/**
 * Ops edits to a teacher that are not pipeline decisions: the scheduling
 * fields, the status, and which of their services are published.
 *
 * Every mutation is audited with before/after, so a disputed suspension is
 * traceable to a person.
 */
@Injectable()
export class AdminInstructorManageService {
  private readonly logger = new Logger(AdminInstructorManageService.name);

  constructor(
    private readonly repo: InstructorRepository,
    private readonly lookup: InstructorProfileLookup,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async updateForAdmin(
    instructorId: string,
    dto: AdminUpdateInstructorDto,
    actor: AdminActor,
  ) {
    const profile = await this.lookup.requireById(instructorId);

    if (dto.branchId && !(await this.repo.branchExists(dto.branchId))) {
      throw new BadRequestException({
        code: ErrorCode.NOT_FOUND,
        message: 'Branch not found',
      });
    }

    const updated = await this.repo.updateProfile(profile.id, {
      ...(dto.branchId !== undefined && {
        branch: { connect: { id: dto.branchId } },
      }),
      ...(dto.dailySessionCap !== undefined && {
        dailySessionCap: dto.dailySessionCap,
      }),
      ...(dto.travelBufferMin !== undefined && {
        travelBufferMin: dto.travelBufferMin,
      }),
      ...(dto.travelRadiusKm !== undefined && {
        travelRadiusKm: dto.travelRadiusKm,
      }),
      // Ops sets this until `instructor_app` exists (§4.5). Without it the
      // PATCH validated the list, audited a change and saved nothing.
      ...(dto.sessionFormats !== undefined && {
        sessionFormats: dto.sessionFormats,
      }),
      // Explicit null clears the override and falls back to the service's own
      // percent, so `!== undefined` rather than a truthiness check.
      ...(dto.commissionPct !== undefined && {
        commissionPct: dto.commissionPct,
      }),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'instructor.updated',
      entityType: 'InstructorProfile',
      entityId: profile.id,
      before: {
        branchId: profile.branchId,
        dailySessionCap: profile.dailySessionCap,
        travelBufferMin: profile.travelBufferMin,
        travelRadiusKm: profile.travelRadiusKm,
        sessionFormats: profile.sessionFormats,
      },
      after: {
        branchId: updated.branchId,
        dailySessionCap: updated.dailySessionCap,
        travelBufferMin: updated.travelBufferMin,
        travelRadiusKm: updated.travelRadiusKm,
        sessionFormats: updated.sessionFormats,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { ...updated, ...profileDates(updated) };
  }

  /**
   * Suspend, blacklist or reinstate. The response carries the count of sessions
   * still booked with this teacher: suspending someone mid-week leaves those
   * customers with nobody coming, and ops needs to see that number, so the
   * reassignment queue is worked rather than discovered on the day.
   */
  async changeStatus(
    instructorId: string,
    dto: ChangeInstructorStatusDto,
    actor: AdminActor,
  ) {
    const profile = await this.lookup.requireById(instructorId);

    const updated = await this.repo.updateProfile(profile.id, {
      status: dto.status,
      statusReason: dto.reason,
      // Off duty immediately, so the slot grid stops offering them before any
      // human gets to the reassignment queue.
      ...(dto.status !== 'ACTIVE' && { dutyStatus: 'OFF_DUTY' }),
    });

    const upcomingSessions = await this.repo.countUpcomingSessions(profile.id);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'instructor.status_changed',
      entityType: 'InstructorProfile',
      entityId: profile.id,
      before: { status: profile.status, statusReason: profile.statusReason },
      after: { status: updated.status, statusReason: updated.statusReason },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    if (dto.status !== 'ACTIVE' && upcomingSessions > 0) {
      this.logger.warn(
        `Instructor ${profile.id} set ${dto.status} with ${upcomingSessions} upcoming session(s) needing reassignment`,
      );
    }

    return { ...updated, ...profileDates(updated), upcomingSessions };
  }

  /**
   * Publish or unpublish one of a provider's service offerings (PDF 6.5).
   * This is what decides whether they appear on Find a Trainer at all.
   */
  async setOfferingApproval(
    instructorId: string,
    serviceId: string,
    approved: boolean,
    actor: AdminActor,
  ) {
    const profile = await this.lookup.requireById(instructorId);

    const { offering, updated } = await setOfferingApproval(
      this.prisma,
      profile.id,
      serviceId,
      approved,
    );

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: approved
        ? 'instructor.offering.approved'
        : 'instructor.offering.revoked',
      entityType: 'InstructorService',
      entityId: updated.id,
      before: { approvedAt: offering.approvedAt },
      after: { approvedAt: updated.approvedAt },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }
}
