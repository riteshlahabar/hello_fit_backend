import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InstructorRepository } from './instructor.repository';
import { ErrorCode } from '../../common/errors/error-codes';
import type { OnboardingStage } from '../../generated/prisma/enums';

/**
 * Resolving a profile and refusing when there isn't one.
 *
 * Every instructor service needs this and the five of them must refuse
 * identically — a teacher-side route that 404s with a different code than its
 * neighbour is how an app ends up with two "not an applicant" screens. Pulled
 * out of `instructor.service.ts` when that file was split.
 */
@Injectable()
export class InstructorProfileLookup {
  constructor(private readonly repo: InstructorRepository) {}

  /** The caller's own profile, from the token subject. */
  async requireOwn(userId: string) {
    const profile = await this.repo.findProfileByUserId(userId);
    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_AN_APPLICANT,
        message: 'Apply as an instructor to continue',
      });
    }
    return profile;
  }

  /** Any profile by id — admin routes only, which carry the id in the path. */
  async requireById(instructorId: string) {
    const profile = await this.repo.findProfileById(instructorId);
    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Instructor not found',
      });
    }
    return profile;
  }

  /**
   * The teacher may edit their own details right up to approval, and again
   * afterwards — but not while a reviewer is mid-decision on a rejected
   * application they have not reopened.
   */
  assertEditable(stage: OnboardingStage): void {
    if (stage === 'REJECTED') {
      throw new ForbiddenException({
        code: ErrorCode.ONBOARDING_STAGE_LOCKED,
        message: 'This application was rejected. Contact support to reopen it.',
      });
    }
  }
}
