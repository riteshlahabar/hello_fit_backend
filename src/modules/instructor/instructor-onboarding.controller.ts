import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InstructorService } from './instructor.service';
import { InstructorDocumentService } from './instructor-document.service';
import { InstructorOfferingService } from './instructor-offering.service';
import type { UploadedFileLike } from './instructor-actor';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import {
  ApplyAsInstructorDto,
  UpdateInstructorProfileDto,
} from './dto/instructor.dto';
import { UploadDocumentDto } from './dto/instructor-document.dto';
import { SetOwnServicesDto } from './dto/instructor-offering.dto';

/**
 * The teacher's own onboarding, KYC uploads and profile (spec 3.6).
 *
 * Every route resolves the profile from the token — no instructor id is ever
 * accepted from the path or the payload, so one teacher cannot read another's
 * documents by guessing a UUID.
 *
 * `apply` is the exception that allows `CUSTOMER`: signup grants only that role
 * (`auth.verifyLoginOtp`), so an applicant arrives holding a customer token and
 * applying is what adds `INSTRUCTOR`. Every other route here needs the role
 * that call creates.
 */
@Controller('app/instructor')
@AllowAudience('app')
export class InstructorOnboardingController {
  constructor(
    private readonly instructors: InstructorService,
    private readonly docs: InstructorDocumentService,
    private readonly offerings: InstructorOfferingService,
  ) {}

  // ------------------------------------------------------------ application

  @Post('apply')
  @Roles('CUSTOMER', 'INSTRUCTOR')
  async apply(
    @CurrentUser('id') userId: string,
    @Body() dto: ApplyAsInstructorDto,
  ) {
    return {
      data: await this.instructors.apply(userId, dto),
      message: 'Application started',
    };
  }

  /** Profile plus the onboarding checklist the "Application status" card shows. */
  @Get('profile')
  @Roles('INSTRUCTOR')
  async getProfile(@CurrentUser('id') userId: string) {
    return { data: await this.instructors.getOwnProfile(userId) };
  }

  @Patch('profile')
  @Roles('INSTRUCTOR')
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateInstructorProfileDto,
  ) {
    return {
      data: await this.instructors.updateOwnProfile(userId, dto),
      message: 'Profile updated',
    };
  }

  // ------------------------------------------------------------- offerings

  /**
   * The services this trainer delivers — page 15's second half.
   *
   * The catalogue itself is the public `GET /services?categoryId=`; this is
   * only which of them the trainer has claimed, and whether ops approved each.
   */
  @Get('services')
  @Roles('INSTRUCTOR')
  async listServices(@CurrentUser('id') userId: string) {
    const services = await this.offerings.listOwn(userId);
    return { data: services, meta: { count: services.length } };
  }

  /** The array is the whole set — an id left out is withdrawn. */
  @Put('services')
  @Roles('INSTRUCTOR')
  @HttpCode(200)
  async setServices(
    @CurrentUser('id') userId: string,
    @Body() dto: SetOwnServicesDto,
  ) {
    return {
      data: await this.offerings.setOwn(userId, dto),
      message: 'Services saved and sent for approval',
    };
  }

  @Post('code-of-conduct')
  @Roles('INSTRUCTOR')
  @HttpCode(200)
  async acceptCodeOfConduct(@CurrentUser('id') userId: string) {
    return {
      data: await this.instructors.acceptCodeOfConduct(userId),
      message: 'Code of conduct accepted',
    };
  }

  /** Hands the application to the reviewers. Refused with reasons if short. */
  @Post('submit')
  @Roles('INSTRUCTOR')
  @HttpCode(200)
  async submit(@CurrentUser('id') userId: string) {
    return {
      data: await this.instructors.submitForReview(userId),
      message: 'Application submitted for review',
    };
  }

  // --------------------------------------------------------------- documents

  @Get('documents')
  @Roles('INSTRUCTOR')
  async listDocuments(@CurrentUser('id') userId: string) {
    const documents = await this.docs.listOwnDocuments(userId);
    return { data: documents, meta: { count: documents.length } };
  }

  /**
   * Multipart upload: `file` plus the `UploadDocumentDto` fields.
   *
   * Memory storage on purpose — the file goes straight to the storage port, so
   * writing it to the app server's temp directory first would leave a copy of a
   * KYC document outside the private bucket. The size limit here is a hard
   * stop; the service re-checks against the configurable policy and gives the
   * caller the proper error code.
   */
  @Post('documents')
  @Roles('INSTRUCTOR')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }),
  )
  async uploadDocument(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return {
      data: await this.docs.uploadOwnDocument(userId, dto, file),
      message: 'Document uploaded',
    };
  }

  /** A time-limited link to one of the caller's own documents. */
  @Get('documents/:documentId/url')
  @Roles('INSTRUCTOR')
  async documentUrl(
    @CurrentUser('id') userId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return { data: await this.docs.getOwnDocumentUrl(userId, documentId) };
  }

  @Delete('documents/:documentId')
  @Roles('INSTRUCTOR')
  @HttpCode(200)
  async deleteDocument(
    @CurrentUser('id') userId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    await this.docs.deleteOwnDocument(userId, documentId);
    return {
      data: { id: documentId, deleted: true },
      message: 'Document removed',
    };
  }
}
