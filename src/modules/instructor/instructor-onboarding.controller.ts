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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InstructorService, type UploadedFileLike } from './instructor.service';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import {
  ApplyAsInstructorDto,
  UpdateInstructorProfileDto,
  UploadDocumentDto,
} from './dto/instructor.dto';

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
  constructor(private readonly instructors: InstructorService) {}

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
    const documents = await this.instructors.listOwnDocuments(userId);
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
      data: await this.instructors.uploadOwnDocument(userId, dto, file),
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
    return { data: await this.instructors.getOwnDocumentUrl(userId, documentId) };
  }

  @Delete('documents/:documentId')
  @Roles('INSTRUCTOR')
  @HttpCode(200)
  async deleteDocument(
    @CurrentUser('id') userId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    await this.instructors.deleteOwnDocument(userId, documentId);
    return {
      data: { id: documentId, deleted: true },
      message: 'Document removed',
    };
  }
}
