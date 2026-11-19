import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  AllowAudience,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { AdminInstructorService } from './admin-instructor.service';
import { ListInstructorsQueryDto } from './dto/admin-instructor.dto';

/**
 * Reading teacher recruitment (spec 5.2, the Teacher Manager role's main
 * screen): the applicant pipeline, one applicant's file, and a link to a
 * document.
 *
 * All three need only `instructors:view`. The decisions — verifying,
 * approving, suspending — live in `AdminInstructorDecisionsController`, behind
 * `instructors:edit` and `instructors:approve`, so that the permission a route
 * demands is obvious from which file it is in.
 */
@Controller('admin/instructors')
@AllowAudience('admin')
export class AdminInstructorController {
  constructor(private readonly instructors: AdminInstructorService) {}

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
}
