import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { todayCalendar, addCalendarDays } from '../../common/dates/calendar';
import { formatDate } from '../../common/dates/format';
import { formatClock } from '../../common/dates/clock';
import { BOOKING_BUCKETS, money, statusLabelOf } from './trainer-view';
import { foldClients, type ClientSessionRow } from './clients.view';

/**
 * Pages 38 (My Clients) and 39 (Client Profile).
 *
 * **There is no client table and none is added.** A "client" is a customer
 * this trainer has delivered or been assigned a session for, so the list is
 * folded out of `BookingSession` — which also means a trainer can never
 * acquire a client the platform did not give them. That is why page 44 "Add
 * New Client" is not built: a trainer creating a customer account would be a
 * second, unverified front door into the user table.
 *
 * Pages 40–42 (fitness information, goals, medical notes) have no columns
 * anywhere in the schema and are not built either.
 */
const DELIVERABLE = [
  ...BOOKING_BUCKETS.confirmed,
  ...BOOKING_BUCKETS.completed,
  ...BOOKING_BUCKETS.pending,
];

@Injectable()
export class TrainerClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async list(
    instructorId: string,
    filter: { status?: 'all' | 'active' | 'inactive'; q?: string },
  ) {
    const clients = foldClients(await this.rows(instructorId), this.activeFrom());

    const summary = {
      all: clients.length,
      active: clients.filter((c) => c.active).length,
      inactive: clients.filter((c) => !c.active).length,
    };

    const wanted = filter.status ?? 'all';
    const needle = filter.q?.trim().toLowerCase();

    const shown = clients.filter(
      (c) =>
        (wanted === 'all' || (wanted === 'active') === c.active) &&
        (!needle ||
          c.name.toLowerCase().includes(needle) ||
          c.service.toLowerCase().includes(needle)),
    );

    return { data: shown, meta: { count: shown.length, summary } };
  }

  /** Page 39 — one client, with the sessions that make them one. */
  async detail(instructorId: string, customerId: string) {
    const rows = await this.rows(instructorId, customerId);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Not one of your clients',
      });
    }

    const [client] = foldClients(rows, this.activeFrom());

    return {
      ...client,
      // The customer's real mobile and email are deliberately absent: contact
      // runs through the masked-calling service (spec 10.1), so page 39's
      // "Personal information" card shows what the booking carries and no more.
      recent: rows.slice(0, 10).map((row) => ({
        sessionId: row.id,
        service: row.service.name,
        status: row.status,
        statusLabel: statusLabelOf(row.status),
        date: formatDate(row.sessionDate),
        time: formatClock(row.fromMinute),
        durationMin: row.durationMin,
        amount: money(row.sessionValue),
      })),
    };
  }

  /** The day a session must fall on or after for its client to read active. */
  private activeFrom(): Date {
    const { clientActiveWindowDays } = this.settings.get('trainerApp');
    return addCalendarDays(todayCalendar(), -clientActiveWindowDays);
  }

  private async rows(
    instructorId: string,
    customerId?: string,
  ): Promise<ClientSessionRow[]> {
    return this.prisma.bookingSession.findMany({
      where: {
        instructorId,
        deletedAt: null,
        status: { in: DELIVERABLE },
        ...(customerId ? { booking: { customerId } } : {}),
      },
      orderBy: [{ sessionDate: 'desc' }, { fromMinute: 'desc' }],
      take: 500,
      select: {
        id: true,
        sessionDate: true,
        fromMinute: true,
        durationMin: true,
        status: true,
        sessionValue: true,
        service: { select: { name: true } },
        booking: {
          select: {
            customer: { select: { id: true, name: true, createdAt: true } },
          },
        },
      },
    });
  }
}
