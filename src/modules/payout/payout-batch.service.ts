import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutService } from './payout.service';
import { SettingsService } from '../settings/settings.service';
import { todayCalendar } from '../../common/dates/calendar';
import { isPayoutRunDay } from './payout.calculator';

/**
 * The weekly payout batch job (spec 3.7).
 *
 * Runs hourly and does nothing on six days out of seven, rather than being
 * registered with a cron expression built from `payoutCycleDay` — that setting
 * is admin-editable at runtime and a `@Cron` expression is fixed at boot, so a
 * changed cycle day would be silently ignored until the next restart. Checking
 * the day in code is a cheap query against a config read.
 *
 * Re-running is safe: `generateForCycle` skips any teacher who already has a
 * batch for the cycle, so a server restarted mid-run picks up where it stopped
 * and nobody is paid twice.
 *
 * Everything it creates is a `DRAFT`. No money moves until finance approves,
 * which is the whole point of the spec putting an approval step here.
 */
@Injectable()
export class PayoutBatchService {
  private readonly logger = new Logger(PayoutBatchService.name);

  /** Guards against an overlapping run if generation outlasts the hour. */
  private running = false;

  constructor(
    private readonly payouts: PayoutService,
    private readonly settings: SettingsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    const policy = this.settings.get('payout');
    if (!isPayoutRunDay(policy, todayCalendar())) return;
    if (this.running) {
      this.logger.warn('Previous payout batch run is still going; skipping');
      return;
    }

    this.running = true;
    try {
      // No actor: a job has no admin. The audit rows it would write are
      // skipped for the same reason — `generateForCycle` only records when an
      // actor is passed, and attributing a cron run to a person would be false.
      const { cycle, results } = await this.payouts.generateForCycle({});

      const created = results.filter((r) => r.payoutId && !r.skipped);
      const belowMinimum = results.filter((r) => r.skipped === 'BELOW_MINIMUM');
      const existing = results.filter((r) => r.skipped === 'ALREADY_EXISTS');

      this.logger.log(
        `Weekly payout batch for ${cycle.from.toISOString().slice(0, 10)}..` +
          `${cycle.to.toISOString().slice(0, 10)}: ` +
          `${created.length} draft(s) worth ${created.reduce((s, r) => s + r.net, 0)}, ` +
          `${belowMinimum.length} under the minimum, ${existing.length} already batched`,
      );
    } catch (error) {
      // Never let the job's failure take the process down; next hour retries,
      // and it is idempotent.
      this.logger.error(
        'Weekly payout batch failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
