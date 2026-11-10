import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { SettingsService } from '../settings/settings.service';
import { PAYOUT_GATEWAY, type PayoutGateway } from './gateway/payout-gateway';
import { ErrorCode } from '../../common/errors/error-codes';
import { parseCalendarDate, todayCalendar } from '../../common/dates/calendar';
import { buildPayoutBatch } from './commission.calculator';
import {
  allowedPayoutTransitions,
  buildStatement,
  canTransitionPayout,
  currentPayoutCycle,
  isPayoutEditable,
  type PayoutCycle,
  type StatementLine,
} from './payout.calculator';
import type {
  FailPayoutDto,
  GeneratePayoutsDto,
  ListEarningsQueryDto,
  ListPayoutsQueryDto,
  MarkPayoutPaidDto,
  WithholdEarningDto,
} from './dto/payout.dto';
import type { AdminActor } from '../instructor/instructor.service';
import type { PayoutStatus } from '../../generated/prisma/enums';

/** What one cycle's generation did, per teacher. */
export interface BatchResult {
  instructorId: string;
  instructorName?: string;
  payoutId?: string;
  sessionCount: number;
  gross: number;
  tds: number;
  net: number;
  /** Why nothing was created, when `payoutId` is absent. */
  skipped?: 'ALREADY_EXISTS' | 'BELOW_MINIMUM' | 'NOTHING_PAYABLE';
}

/**
 * Payout batches (spec 3.7) — the last piece of Phase 3.
 *
 * The money path is: a completed session writes an `Earning` as `PENDING`; the
 * review-window cron flips it to `PAYABLE` once the dispute window closes; this
 * module gathers a week of `PAYABLE` earnings per teacher into a `Payout`,
 * applies TDS, and waits for finance to approve before anything is transferred.
 *
 * Two invariants everything here protects:
 *
 * 1. **An earning is paid once.** It can be in at most one `PayoutItem`
 *    (unique column), is only selected when it has none, and only becomes
 *    `PAID` when the payout it sits in does.
 * 2. **Nothing moves without a human.** `DRAFT` → `APPROVED` is a separate,
 *    permissioned action from generation, and the transfer is a third.
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly repo: PayoutRepository,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    @Inject(PAYOUT_GATEWAY) private readonly gateway: PayoutGateway,
  ) {}

  // ======================================================= batch generation

  /**
   * Builds one cycle's drafts. Idempotent per `(instructor, cycle)`: a teacher
   * who already has a batch for the cycle is skipped, not duplicated — the
   * weekly job can be re-run after a partial failure without paying twice.
   *
   * Below-minimum totals are skipped rather than created, so the earnings stay
   * in the pool and roll into the next cycle. That is the intended behaviour of
   * `minimumPayoutAmount`: a bank charge on a ₹40 transfer costs more than
   * waiting a week.
   */
  async generateForCycle(
    dto: GeneratePayoutsDto,
    actor?: AdminActor,
  ): Promise<{ cycle: PayoutCycle; results: BatchResult[]; dryRun: boolean }> {
    const policy = this.settings.get('payout');
    const cycle = this.resolveCycle(dto);
    const now = new Date();

    const instructorIds = dto.instructorId
      ? [dto.instructorId]
      : await this.repo.findInstructorsWithPayableEarnings({
          cycleFrom: cycle.from,
          cycleTo: cycle.to,
          now,
        });

    const results: BatchResult[] = [];

    for (const instructorId of instructorIds) {
      const existing = await this.repo.findPayoutForCycle(
        instructorId,
        cycle.from,
        cycle.to,
      );
      if (existing) {
        results.push({
          instructorId,
          payoutId: existing.id,
          sessionCount: 0,
          gross: 0,
          tds: 0,
          net: Number(existing.net),
          skipped: 'ALREADY_EXISTS',
        });
        continue;
      }

      const earnings = await this.repo.findPayableEarnings({
        cycleFrom: cycle.from,
        cycleTo: cycle.to,
        instructorId,
        now,
      });

      if (earnings.length === 0) {
        results.push({
          instructorId,
          sessionCount: 0,
          gross: 0,
          tds: 0,
          net: 0,
          skipped: 'NOTHING_PAYABLE',
        });
        continue;
      }

      const batch = buildPayoutBatch(
        earnings.map((e) => ({
          id: e.id,
          netAmount: Number(e.netAmount),
          deductions: Number(e.deductions),
        })),
        policy,
      );

      if (!batch.meetsMinimum) {
        results.push({
          instructorId,
          sessionCount: earnings.length,
          gross: batch.gross,
          tds: batch.tds,
          net: batch.net,
          skipped: 'BELOW_MINIMUM',
        });
        continue;
      }

      if (dto.dryRun) {
        results.push({
          instructorId,
          sessionCount: earnings.length,
          gross: batch.gross,
          tds: batch.tds,
          net: batch.net,
        });
        continue;
      }

      const payout = await this.repo.createBatch({
        instructorId,
        cycleFrom: cycle.from,
        cycleTo: cycle.to,
        gross: batch.gross,
        tds: batch.tds,
        deductions: batch.deductions,
        net: batch.net,
        items: earnings.map((e) => ({
          earningId: e.id,
          amount: Number(e.netAmount),
        })),
      });

      results.push({
        instructorId,
        payoutId: payout.id,
        sessionCount: earnings.length,
        gross: batch.gross,
        tds: batch.tds,
        net: batch.net,
      });

      if (actor) {
        await this.audit.record({
          adminUserId: actor.adminUserId,
          action: 'payout.generated',
          entityType: 'Payout',
          entityId: payout.id,
          after: {
            instructorId,
            gross: batch.gross,
            tds: batch.tds,
            net: batch.net,
            sessionCount: earnings.length,
          },
          ipAddress: actor.ipAddress,
          requestId: actor.requestId,
        });
      }
    }

    const created = results.filter((r) => r.payoutId && !r.skipped).length;
    this.logger.log(
      `Payout cycle ${cycle.from.toISOString().slice(0, 10)}..${cycle.to
        .toISOString()
        .slice(0, 10)}: ${created} batch(es) from ${instructorIds.length} teacher(s)` +
        (dto.dryRun ? ' [dry run]' : ''),
    );

    return { cycle, results, dryRun: Boolean(dto.dryRun) };
  }

  /**
   * Explicit dates win; otherwise the cycle that most recently closed. Both
   * halves are parsed as calendar days — a payout cycle is a range of dates,
   * not of instants, and `new Date('2026-11-02')` would shift a day in any
   * UTC+ timezone.
   */
  private resolveCycle(dto: GeneratePayoutsDto): PayoutCycle {
    if (dto.cycleFrom && dto.cycleTo) {
      const from = parseCalendarDate(dto.cycleFrom);
      const to = parseCalendarDate(dto.cycleTo);
      if (from.getTime() > to.getTime()) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'cycleFrom must not be after cycleTo',
        });
      }
      return { from, to };
    }

    if (dto.cycleFrom || dto.cycleTo) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Send both cycleFrom and cycleTo, or neither',
      });
    }

    return currentPayoutCycle(this.settings.get('payout'), todayCalendar());
  }

  // =============================================================== admin read

  async listPayouts(query: ListPayoutsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { rows, total, totals } = await this.repo.listPayouts({
      instructorId: query.instructorId,
      status: query.status,
      cycleFrom: query.cycleFrom ? parseCalendarDate(query.cycleFrom) : undefined,
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      rows,
      meta: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        totals: {
          gross: Number(totals.gross ?? 0),
          tds: Number(totals.tds ?? 0),
          net: Number(totals.net ?? 0),
        },
      },
    };
  }

  async getPayout(payoutId: string) {
    const payout = await this.requirePayout(payoutId);
    return {
      ...payout,
      statement: this.statementFrom(payout),
      allowedTransitions: allowedPayoutTransitions(payout.status),
      gatewayIsAutomated: this.gateway.isAutomated,
    };
  }

  async listEarnings(query: ListEarningsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const { rows, total } = await this.repo.listEarnings({
      instructorId: query.instructorId,
      status: query.status,
      from: query.from ? parseCalendarDate(query.from) : undefined,
      to: query.to ? parseCalendarDate(query.to) : undefined,
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  // ============================================================ admin actions

  /** Finance signs off. Nothing may be transferred before this. */
  async approve(payoutId: string, remark: string | undefined, actor: AdminActor) {
    const payout = await this.requirePayout(payoutId);
    this.assertTransition(payout.status, 'APPROVED');

    const updated = await this.repo.updatePayout(payoutId, {
      status: 'APPROVED',
      approvedBy: { connect: { id: actor.adminUserId } },
      approvedAt: new Date(),
      // Clear a previous failure so the row does not show a stale reason.
      failureReason: null,
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'payout.approved',
      entityType: 'Payout',
      entityId: payoutId,
      before: { status: payout.status },
      after: { status: updated.status, net: Number(updated.net) },
      reason: remark,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }

  /**
   * Hands the approved batch to the payout rail. With the manual rail that
   * means recording the intent — finance moves the money and then calls
   * `markPaid` with the UTR. With an automated rail the gateway returns
   * `PROCESSING` and settlement arrives later.
   *
   * Refused without verified bank details: an approved payout with nowhere to
   * send the money is a batch that will sit in `INITIATED` forever.
   */
  async initiate(payoutId: string, actor: AdminActor) {
    const payout = await this.requirePayout(payoutId);
    this.assertTransition(payout.status, 'INITIATED');

    const beneficiary = await this.repo.findBeneficiary(payout.instructorId);
    if (!beneficiary) {
      throw new ConflictException({
        code: ErrorCode.PAYOUT_NO_BENEFICIARY,
        message:
          'This teacher has no verified bank details. Verify their BANK_DETAILS document first.',
      });
    }

    const result = await this.gateway.transfer({
      reference: payout.id,
      amount: Number(payout.net),
      currency: 'INR',
      beneficiary: {
        name: payout.instructor.name,
        // `Document.number` holds the masked/encrypted reference; the rail
        // resolves the real account from it. Never logged.
        accountNumber: beneficiary.number ?? undefined,
      },
      narration: `HelloFit payout ${payout.cycleFrom.toISOString().slice(0, 10)}`,
    });

    this.assertTransition(payout.status, result.status as PayoutStatus);

    const updated = await this.repo.updatePayout(payoutId, {
      status: result.status,
      ...(result.utr && { utr: result.utr }),
      ...(result.status === 'PAID' && { paidAt: new Date() }),
      ...(result.failureReason && { failureReason: result.failureReason }),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'payout.initiated',
      entityType: 'Payout',
      entityId: payoutId,
      before: { status: payout.status },
      after: {
        status: updated.status,
        gateway: this.gateway.name,
        transferId: result.transferId,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return {
      ...updated,
      gateway: this.gateway.name,
      requiresManualTransfer: !this.gateway.isAutomated,
    };
  }

  /**
   * Records a settled transfer. This is the only place earnings become `PAID`,
   * and it happens in the same transaction as the payout — an earning left
   * `PAYABLE` under a paid payout would be picked up by the next batch and paid
   * a second time.
   */
  async markPaid(payoutId: string, dto: MarkPayoutPaidDto, actor: AdminActor) {
    const payout = await this.requirePayout(payoutId);
    this.assertTransition(payout.status, 'PAID');

    const updated = await this.repo.markPaid({
      payoutId,
      utr: dto.utr,
      paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'payout.paid',
      entityType: 'Payout',
      entityId: payoutId,
      before: { status: payout.status },
      after: {
        status: updated.status,
        utr: updated.utr,
        net: Number(updated.net),
        earningsMarkedPaid: payout.items.length,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    await this.notifications.emit('payout.paid', {
      instructor: { instructorId: payout.instructorId },
      data: {
        cycleFrom: payout.cycleFrom,
        cycleTo: payout.cycleTo,
        net: Number(updated.net),
        utr: dto.utr,
      },
    });

    this.logger.log(
      `Payout ${payoutId} paid: ${Number(updated.net)} to instructor=${payout.instructorId} utr=${dto.utr}`,
    );
    return updated;
  }

  /**
   * The transfer bounced. The earnings are untouched — they were never moved
   * out of `PAYABLE` — so a retry needs only `FAILED` → `APPROVED` once the
   * bank details are fixed.
   */
  async fail(payoutId: string, dto: FailPayoutDto, actor: AdminActor) {
    const payout = await this.requirePayout(payoutId);
    this.assertTransition(payout.status, 'FAILED');

    const updated = await this.repo.updatePayout(payoutId, {
      status: 'FAILED',
      failureReason: dto.reason,
    });

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'payout.failed',
      entityType: 'Payout',
      entityId: payoutId,
      before: { status: payout.status },
      after: { status: updated.status, failureReason: dto.reason },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    await this.notifications.emit('payout.failed', {
      instructor: { instructorId: payout.instructorId },
      admin: true,
      data: {
        cycleFrom: payout.cycleFrom,
        cycleTo: payout.cycleTo,
        reason: dto.reason,
      },
    });

    this.logger.warn(`Payout ${payoutId} failed: ${dto.reason}`);
    return updated;
  }

  /**
   * Discards a draft and returns its earnings to the pool. Only a draft:
   * anything further has finance's signature on it, and deleting that would
   * erase the approval rather than reverse it.
   */
  async deleteDraft(payoutId: string, actor: AdminActor) {
    const payout = await this.requirePayout(payoutId);

    if (!isPayoutEditable(payout.status)) {
      throw new ConflictException({
        code: ErrorCode.PAYOUT_NOT_EDITABLE,
        message: `A ${payout.status} payout cannot be deleted. Mark it failed instead.`,
      });
    }

    await this.repo.deleteDraft(payoutId);

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'payout.draft_deleted',
      entityType: 'Payout',
      entityId: payoutId,
      before: {
        status: payout.status,
        net: Number(payout.net),
        sessionCount: payout.items.length,
      },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return { id: payoutId, deleted: true, earningsReleased: payout.items.length };
  }

  // ------------------------------------------------------------- earning holds

  /**
   * Holds an earning out of every future batch — a disputed session, a quality
   * investigation, a double-booked slot. Refused once it is in a batch: the
   * batch is the thing to act on then, not the line inside it.
   */
  async withholdEarning(
    earningId: string,
    dto: WithholdEarningDto,
    actor: AdminActor,
  ) {
    const earning = await this.requireEarning(earningId);

    if (earning.payoutItem) {
      throw new ConflictException({
        code: ErrorCode.EARNING_ALREADY_BATCHED,
        message:
          'This earning is already in a payout. Delete the draft or fail the payout instead.',
      });
    }

    if (earning.status === 'PAID') {
      throw new ConflictException({
        code: ErrorCode.EARNING_NOT_ADJUSTABLE,
        message: 'A paid earning cannot be withheld',
      });
    }

    const updated = await this.repo.setEarningStatus(
      earningId,
      'WITHHELD',
      dto.reason,
    );

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'earning.withheld',
      entityType: 'Earning',
      entityId: earningId,
      before: { status: earning.status, withheldReason: earning.withheldReason },
      after: { status: updated.status, withheldReason: updated.withheldReason },
      reason: dto.reason,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }

  /**
   * Releases a held earning. It returns to `PAYABLE` only when its dispute
   * window has already closed, otherwise back to `PENDING` so the cron
   * releases it at the right time — skipping that would pay a session whose
   * dispute window is still open.
   */
  async releaseEarning(earningId: string, actor: AdminActor) {
    const earning = await this.requireEarning(earningId);

    if (earning.status !== 'WITHHELD') {
      throw new ConflictException({
        code: ErrorCode.EARNING_NOT_ADJUSTABLE,
        message: `Only a withheld earning can be released; this one is ${earning.status}`,
      });
    }

    const windowClosed =
      !earning.payableFrom || earning.payableFrom.getTime() <= Date.now();

    const updated = await this.repo.setEarningStatus(
      earningId,
      windowClosed ? 'PAYABLE' : 'PENDING',
      null,
    );

    await this.audit.record({
      adminUserId: actor.adminUserId,
      action: 'earning.released',
      entityType: 'Earning',
      entityId: earningId,
      before: { status: earning.status, withheldReason: earning.withheldReason },
      after: { status: updated.status },
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });

    return updated;
  }

  // ========================================================== teacher side

  async listOwnPayouts(userId: string, page: number, limit: number) {
    const profile = await this.requireOwnProfile(userId);
    const [rows, total] = await this.repo.listPayoutsForInstructor(
      profile.id,
      (page - 1) * limit,
      limit,
    );
    return {
      rows,
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** The teacher's own statement — scoped by profile id, not by path param. */
  async getOwnPayout(userId: string, payoutId: string) {
    const profile = await this.requireOwnProfile(userId);
    const payout = await this.repo.findPayoutForInstructor(profile.id, payoutId);
    if (!payout) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Payout not found',
      });
    }
    return { ...payout, statement: this.statementFrom(payout) };
  }

  // =============================================================== internals

  private async requirePayout(payoutId: string) {
    const payout = await this.repo.findPayoutById(payoutId);
    if (!payout) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Payout not found',
      });
    }
    return payout;
  }

  private async requireEarning(earningId: string) {
    const earning = await this.repo.findEarningById(earningId);
    if (!earning) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Earning not found',
      });
    }
    return earning;
  }

  private async requireOwnProfile(userId: string) {
    const profile = await this.repo.findInstructorProfileByUserId(userId);
    if (!profile) {
      throw new NotFoundException({
        code: ErrorCode.NOT_AN_APPLICANT,
        message: 'No instructor profile on this account',
      });
    }
    return profile;
  }

  private assertTransition(from: PayoutStatus, to: PayoutStatus): void {
    if (!canTransitionPayout(from, to)) {
      throw new BadRequestException({
        code: ErrorCode.PAYOUT_TRANSITION_INVALID,
        message: `A ${from} payout cannot become ${to}`,
        details: allowedPayoutTransitions(from),
      });
    }
  }

  /**
   * The TDS percentage is back-derived from the stored amounts rather than read
   * from current settings, so a settled statement never restates itself when
   * the policy changes.
   */
  private statementFrom(payout: {
    cycleFrom: Date;
    cycleTo: Date;
    gross: unknown;
    tds: unknown;
    items: Array<{
      amount: unknown;
      earning: {
        sessionValue: unknown;
        commissionAmount: unknown;
        deductions: unknown;
        netAmount: unknown;
        session: {
          id: string;
          sessionDate: Date;
          service: { name: string };
        };
      };
    }>;
  }) {
    const gross = Number(payout.gross);
    const tds = Number(payout.tds);

    const lines: StatementLine[] = payout.items.map((item) => ({
      sessionId: item.earning.session.id,
      sessionDate: item.earning.session.sessionDate,
      serviceName: item.earning.session.service.name,
      sessionValue: Number(item.earning.sessionValue),
      commissionAmount: Number(item.earning.commissionAmount),
      deductions: Number(item.earning.deductions),
      netAmount: Number(item.earning.netAmount),
    }));

    return buildStatement({
      cycle: { from: payout.cycleFrom, to: payout.cycleTo },
      lines,
      tds,
      tdsPercent: gross > 0 ? Math.round((tds / gross) * 10000) / 100 : 0,
    });
  }
}
