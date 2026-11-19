import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AllowAudience,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { AdminInstructorManageService } from './admin-instructor-manage.service';
import { AdminInstructorReviewService } from './admin-instructor-review.service';
import { adminActorFrom } from './instructor-actor';
import {
  AdminUpdateInstructorDto,
  ChangeInstructorStatusDto,
  ChangeOnboardingStageDto,
  SetOfferingApprovalDto,
  VerifyDocumentDto,
} from './dto/admin-instructor.dto';

/**
 * Every teacher decision an administrator can take (spec 5.2).
 *
 * Document and profile decisions need `instructors:edit`; moving someone to
 * `APPROVED`, suspending them, or publishing one of their services needs
 * `instructors:approve` — the irreversible-in-practice actions sit behind a
 * permission the Operations Manager role does not get by default.
 *
 * Every route here writes an audit row with before/after and the actor's IP
 * and request id, so a disputed rejection is traceable to a person. The reads
 * are in `AdminInstructorController`.
 */
@Controller('admin/instructors')
@AllowAudience('admin')
export class AdminInstructorDecisionsController {
  constructor(
    private readonly review: AdminInstructorReviewService,
    private readonly manage: AdminInstructorManageService,
  ) {}

  @Post(':id/documents/:documentId/verify')
  @RequirePermissions('instructors:edit')
  @HttpCode(200)
  async verifyDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: VerifyDocumentDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.review.verifyDocument(
        id,
        documentId,
        dto,
        adminActorFrom(userId, req),
      ),
      message: `Document ${dto.verifyStatus.toLowerCase()}`,
    };
  }

  /**
   * Moves the applicant along the pipeline. Refused when the transition is
   * illegal, and `APPROVED` is additionally refused while any must-verify
   * document is unverified or expired.
   */
  @Post(':id/stage')
  @RequirePermissions('instructors:approve')
  @HttpCode(200)
  async changeStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeOnboardingStageDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.review.changeStage(
        id,
        dto,
        adminActorFrom(userId, req),
      ),
      message: `Moved to ${dto.stage}`,
    };
  }

  /** Branch, daily cap, travel buffer and radius — the scheduling inputs. */
  @Patch(':id')
  @RequirePermissions('instructors:edit')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateInstructorDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.manage.updateForAdmin(
        id,
        dto,
        adminActorFrom(userId, req),
      ),
      message: 'Instructor updated',
    };
  }

  /**
   * Suspend, blacklist or reinstate. The response reports how many sessions are
   * still booked with this teacher — those need reassigning.
   */
  @Post(':id/status')
  @RequirePermissions('instructors:approve')
  @HttpCode(200)
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeInstructorStatusDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    const result = await this.manage.changeStatus(
      id,
      dto,
      adminActorFrom(userId, req),
    );
    return {
      data: result,
      message:
        result.upcomingSessions > 0
          ? `Status updated. ${result.upcomingSessions} upcoming session(s) need reassignment.`
          : 'Status updated',
    };
  }

  /**
   * Publish or unpublish one of this provider's service offerings (PDF 6.5,
   * "manage permitted service visibility"). This is the switch that puts them
   * on the website's Find a Trainer at all — see provider-visibility.ts.
   */
  @Post(':id/services/:serviceId/approval')
  @RequirePermissions('instructors:approve')
  @HttpCode(200)
  async setOfferingApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: SetOfferingApprovalDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    const data = await this.manage.setOfferingApproval(
      id,
      serviceId,
      dto.approved,
      adminActorFrom(userId, req),
    );
    return {
      data,
      message: dto.approved ? 'Service published' : 'Service unpublished',
    };
  }
}
