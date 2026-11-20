import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';

/** What the trainer-app surfaces need to know about who is calling. */
export interface InstructorContext {
  id: string;
  name: string;
  status: string;
  stage: string;
  /** False while the application is still in the pipeline. */
  active: boolean;
}

/**
 * Resolves the token's `User` id to the `InstructorProfile` every
 * `/app/instructor/*` route hangs off.
 *
 * Two variants on purpose. `require` is the old session-tab behaviour — a
 * teacher who is not approved has no business starting a session, so it 404s.
 * `peek` answers for anyone with a profile, because the **shell is reachable
 * before approval** (client, 20-11-2026): Home has to render its pending
 * banner and four zeroes rather than erroring out.
 */
@Injectable()
export class InstructorContextService {
  constructor(private readonly prisma: PrismaService) {}

  /** Profile or 404 — the caller does not care about the stage. */
  async peek(userId: string): Promise<InstructorContext> {
    const profile = await this.prisma.instructorProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true, name: true, status: true, onboardingStage: true },
    });

    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'No instructor profile on this account',
      });
    }

    return {
      id: profile.id,
      name: profile.name,
      status: profile.status,
      stage: profile.onboardingStage,
      active: profile.status === 'ACTIVE' && profile.onboardingStage === 'APPROVED',
    };
  }

  /** Profile id, but only for a trainer who may actually work. */
  async require(userId: string): Promise<string> {
    const context = await this.peek(userId);

    if (!context.active) {
      throw new NotFoundException({
        code: ErrorCode.FORBIDDEN,
        message: 'Your teacher account is not active',
      });
    }

    return context.id;
  }
}
