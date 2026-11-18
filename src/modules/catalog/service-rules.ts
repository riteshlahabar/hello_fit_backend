import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * The head-count rule, in one place.
 *
 * The two percentage systems never meet: a solo service is priced by package
 * and pinned to one person, a group service is priced by slab and must reach
 * at least two — a group service topping out at one would offer a dropdown
 * with a single entry no slab could ever match.
 *
 * Create, pricing and edit all land here so the three routes cannot drift.
 * `current` is the row's present ceiling on an edit, and 2 on a create.
 */
export function resolveMaxParticipants(
  allowMultiPerson: boolean,
  asked: number | undefined,
  current: number,
): number {
  if (!allowMultiPerson) {
    if (asked !== undefined && asked > 1) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          'A service priced by package takes one person per session. Turn on allowMultiPerson first.',
      });
    }
    return 1;
  }

  const next = asked ?? current;

  if (next < 2) {
    throw new BadRequestException({
      code: ErrorCode.VALIDATION_FAILED,
      message: 'A group service needs maxParticipants of at least 2',
    });
  }

  return next;
}
