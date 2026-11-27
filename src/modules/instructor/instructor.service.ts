import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InstructorRepository } from './instructor.repository';
import { InstructorProfileLookup } from './instructor-profile.lookup';
import { decorateProfile } from './instructor-view';
import { canSubmitForReview, deriveKycStatus } from './onboarding';
import { pickProfileContactFields } from './profile-contact-fields';
import { SettingsService } from '../settings/settings.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { parseCalendarDate } from '../../common/dates/calendar';
import { formatDateTimeOrNull } from '../../common/dates/format';
import type {
  ApplyAsInstructorDto,
  UpdateInstructorProfileDto,
} from './dto/instructor.dto';

/**
 * The teacher's own application and profile (spec 3.6).
 *
 * This closes the Phase 1 gap that made the teacher side unusable: there was no
 * way to create an `InstructorProfile`, so `assignment`'s hard filter on
 * "active and KYC verified" was testing a flag nothing could ever set.
 *
 * Signup only ever grants `CUSTOMER` (`auth.verifyLoginOtp`), so applying is
 * what creates the profile and adds the `INSTRUCTOR` role — which is why
 * `apply` is reachable with a customer token and every other route here is not.
 *
 * Documents live in `InstructorDocumentService`, the admin side in the three
 * `admin-instructor-*.service.ts` files. All five share
 * `InstructorProfileLookup` and `instructor-view.ts`.
 */
@Injectable()
export class InstructorService {
  private readonly logger = new Logger(InstructorService.name);

  constructor(
    private readonly repo: InstructorRepository,
    private readonly lookup: InstructorProfileLookup,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Starts an application. One per account: a second call is a conflict rather
   * than a second profile, because `InstructorProfile.userId` is unique and the
   * duplicate would surface as a raw Prisma error.
   */
  async apply(userId: string, dto: ApplyAsInstructorDto) {
    // Registering in the trainer app now creates the profile row itself
    // (client, 27-11-2026), so finding one is no longer proof of a second
    // application. The stub it leaves has no name; anything named is a real
    // application and still conflicts.
    const existing = await this.repo.findProfileByUserId(userId);
    if (existing && existing.name !== '') {
      throw new ConflictException({
        code: ErrorCode.APPLICATION_EXISTS,
        message: 'An application already exists for this account',
      });
    }

    const profile = await this.repo.createApplication(userId, {
      name: dto.name,
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(dto.experienceYears !== undefined && {
        experienceYears: dto.experienceYears,
      }),
      travelBufferMin: this.settings.get('scheduling').defaultTravelBufferMin,
    });

    this.logger.log(`Instructor application created profile=${profile.id}`);
    return this.decorate(profile, []);
  }

  /** The caller's own application, with the checklist the app renders. */
  async getOwnProfile(userId: string) {
    const profile = await this.lookup.requireOwn(userId);
    const documents = await this.repo.listDocuments(profile.id);
    // `email` is a User column, and page 66's box must show what is on file.
    // Flattened rather than left as the nested relation, so the response stays
    // one object and no other User field rides along.
    const { user, ...rest } = profile as typeof profile & {
      user?: { email: string | null };
    };
    return { ...this.decorate(rest, documents), email: user?.email ?? null };
  }

  async updateOwnProfile(userId: string, dto: UpdateInstructorProfileDto) {
    const profile = await this.lookup.requireOwn(userId);
    this.lookup.assertEditable(profile.onboardingStage);

    // Both halves of the home base or neither: a lone latitude would be scored
    // against longitude 0, which is in the Atlantic.
    const lat = dto.homeBaseLat ?? null;
    const lng = dto.homeBaseLng ?? null;
    if ((lat === null) !== (lng === null)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'homeBaseLat and homeBaseLng must be sent together',
      });
    }

    const updated = await this.repo.updateProfile(profile.id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.gender !== undefined && { gender: dto.gender }),
      ...(dto.dob !== undefined && { dob: parseCalendarDate(dto.dob) }),
      ...(dto.bio !== undefined && { bio: dto.bio }),
      ...(dto.experienceYears !== undefined && {
        experienceYears: dto.experienceYears,
      }),
      ...(dto.languages !== undefined && { languages: { set: dto.languages } }),
      ...(dto.specialisations !== undefined && {
        specialisations: { set: dto.specialisations },
      }),
      ...(dto.homeBaseLat !== undefined && { homeBaseLat: dto.homeBaseLat }),
      ...(dto.homeBaseLng !== undefined && { homeBaseLng: dto.homeBaseLng }),
      ...(dto.travelRadiusKm !== undefined && {
        travelRadiusKm: dto.travelRadiusKm,
      }),
      ...pickProfileContactFields(dto),
    });

    // `email` lives on User, which already owns a unique email column; the
    // profile has none and should not grow a second copy.
    if (dto.email !== undefined) {
      await this.repo.updateUserEmail(userId, dto.email);
    }

    const documents = await this.repo.listDocuments(profile.id);
    return this.decorate(updated, documents);
  }

  /** One-time acceptance, required before an application can be submitted. */
  async acceptCodeOfConduct(userId: string) {
    const profile = await this.lookup.requireOwn(userId);
    // Hard rule 4: `dd-mm-yyyy HH:mm:ss` on the wire, never an ISO instant.
    if (profile.codeOfConductAt) {
      return { acceptedAt: formatDateTimeOrNull(profile.codeOfConductAt) };
    }
    const updated = await this.repo.updateProfile(profile.id, {
      codeOfConductAt: new Date(),
    });
    return { acceptedAt: formatDateTimeOrNull(updated.codeOfConductAt) };
  }

  /**
   * Submits the application for review. The gate is the pure calculator, so the
   * app can show the same checklist before the call and the reasons after it.
   */
  async submitForReview(userId: string) {
    const profile = await this.lookup.requireOwn(userId);

    if (profile.onboardingStage !== 'APPLIED') {
      throw new ConflictException({
        code: ErrorCode.ONBOARDING_STAGE_LOCKED,
        message: 'This application has already been submitted',
      });
    }

    const policy = this.settings.get('onboarding');
    const documents = await this.repo.listDocuments(profile.id);
    const gate = canSubmitForReview(policy, profile, documents);

    if (!gate.ok) {
      throw new BadRequestException({
        code: ErrorCode.ONBOARDING_INCOMPLETE,
        message: 'Your application is not complete yet',
        details: gate.reasons,
      });
    }

    const updated = await this.repo.updateProfile(profile.id, {
      onboardingStage: 'DOCUMENTS_SUBMITTED',
      kycStatus: deriveKycStatus(policy, documents),
    });

    this.logger.log(`Application submitted instructor=${profile.id}`);
    return this.decorate(updated, documents);
  }

  private decorate(
    profile: Parameters<typeof decorateProfile>[1],
    documents: Parameters<typeof decorateProfile>[2],
  ) {
    return decorateProfile(this.settings.get('onboarding'), profile, documents);
  }
}
