import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AllowAudience,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { InstructorService, type AdminActor } from './instructor.service';
import {
  AdminUpdateInstructorDto,
  ChangeInstructorStatusDto,
  ChangeOnboardingStageDto,
  ListInstructorsQueryDto,
  VerifyDocumentDto,
} from './dto/admin-instructor.dto';

/**
 * Teacher recruitment and document verification (spec 5.2, the Teacher Manager
 * role's main screen).
 *
 * Reads need `instructors:view`; profile and document decisions need
 * `instructors:edit`; moving someone to `APPROVED` or suspending them needs
 * `instructors:approve` — the irreversible-in-practice actions sit behind a
 * permission the Operations Manager role does not get by default.
 *
 * Every mutation writes an audit row with before/after and the actor's IP and
 * request id, so a disputed rejection is traceable to a person.
 */
@Controller('admin/instructors')
@AllowAudience('admin')
export class AdminInstructorController {
  constructor(private readonly instructors: InstructorService) {}

  @Get()
  @RequirePermissions('instructors:view')
  async list(@Query() query: ListInstructorsQueryDto) {
    const { rows, meta } = await this.instructors.listForAdmin(query);
    return { data: rows, meta };
  }

  /** The full applicant file, including what is blocking approval. */
  @Get(':id')
  @RequirePermissions('instructors:view')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.instructors.getForAdmin(id) };
  }

  @Get(':id/documents/:documentId/url')
  @RequirePermissions('instructors:view')
  async documentUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return {
      data: await this.instructors.getDocumentUrlForAdmin(id, documentId),
    };
  }

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
      data: await this.instructors.verifyDocument(
        id,
        documentId,
        dto,
        this.actor(userId, req),
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
      data: await this.instructors.changeStage(
        id,
        dto,
        this.actor(userId, req),
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
      data: await this.instructors.updateForAdmin(
        id,
        dto,
        this.actor(userId, req),
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
    const result = await this.instructors.changeStatus(
      id,
      dto,
      this.actor(userId, req),
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
   * On an admin route the token subject is the `AdminUser.id`, so `@CurrentUser`
   * already gives the audit row its actor. Request id comes from
   * `RequestIdMiddleware`.
   */
  private actor(userId: string, req: Request): AdminActor {
    return {
      adminUserId: userId,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string | undefined,
    };
  }
}
