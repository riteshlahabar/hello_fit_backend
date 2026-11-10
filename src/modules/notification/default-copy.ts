import type { NotificationAudience } from '../../generated/prisma/enums';

/**
 * Built-in English copy for every event in the matrix.
 *
 * Why this exists rather than seeding `NotificationTemplate` rows: a template
 * row is *ops-owned data* that can be edited or deactivated, and a notification
 * silently not sending because someone deleted a row is a bad failure mode. So
 * the database holds overrides and this holds the floor — an event always has
 * something to say, and ops editing copy is a deliberate improvement on a
 * working default rather than a prerequisite for shipping.
 *
 * One entry per (event, audience), not per channel. SMS has a tighter budget
 * than push, but writing the same sentence three times invites them to drift;
 * these are kept short enough to work as a text message and the admin template
 * editor is where channel-specific copy belongs.
 *
 * Placeholders must come from the matching event's `variables` list in
 * `events.ts` — the unit tests check exactly that.
 */

export interface Copy {
  title?: string;
  body: string;
  deepLink?: string;
}

export const DEFAULT_COPY: Record<
  string,
  Partial<Record<NotificationAudience, Copy>>
> = {
  'booking.created_payment_pending': {
    CUSTOMER: {
      title: 'Finish your booking',
      body: 'Booking {{bookingCode}} is held for {{holdMinutes}} minutes. Pay ₹{{payable}} to confirm.',
      deepLink: '/bookings/{{bookingCode}}/pay',
    },
  },
  'booking.confirmed': {
    CUSTOMER: {
      title: 'Booking confirmed',
      body: 'Your session on {{sessionDate}} at {{fromTime}} is confirmed. Booking {{bookingCode}}.',
      deepLink: '/bookings/{{bookingCode}}',
    },
    ADMIN: {
      title: 'New booking',
      body: '{{bookingCode}} confirmed for {{sessionDate}} {{fromTime}}.',
      deepLink: '/admin/bookings/{{bookingCode}}',
    },
  },
  'booking.payment_failed': {
    CUSTOMER: {
      title: 'Payment not completed',
      body: 'We could not confirm booking {{bookingCode}}. {{reason}} Your slot has been released.',
      deepLink: '/bookings/{{bookingCode}}',
    },
    ADMIN: {
      title: 'Payment failed',
      body: '{{bookingCode}}: {{reason}}',
      deepLink: '/admin/bookings/{{bookingCode}}',
    },
  },

  'offer.created': {
    INSTRUCTOR: {
      title: 'New session offer',
      body: '{{areaName}}, {{sessionDate}} {{fromTime}}–{{toTime}}. Respond within {{expiresInMin}} minutes.',
      deepLink: '/instructor/offers',
    },
  },
  'assignment.confirmed': {
    CUSTOMER: {
      title: 'Your teacher is confirmed',
      body: '{{instructorName}} will take your session on {{sessionDate}} at {{fromTime}}.',
      deepLink: '/bookings',
    },
    INSTRUCTOR: {
      title: 'Session assigned',
      body: 'You are assigned for {{sessionDate}} at {{fromTime}}.',
      deepLink: '/instructor/schedule',
    },
    ADMIN: {
      title: 'Teacher assigned',
      body: '{{instructorName}} assigned for {{sessionDate}} {{fromTime}}.',
      deepLink: '/admin/bookings',
    },
  },
  'assignment.cascade_exhausted': {
    ADMIN: {
      title: 'Assignment needed',
      body: 'No teacher accepted {{bookingCode}} for {{sessionDate}} {{fromTime}} after {{attempts}} offers.',
      deepLink: '/admin/assignment-queue',
    },
  },

  'session.reminder_24h': {
    CUSTOMER: {
      title: 'Session tomorrow',
      body: '{{instructorName}} arrives {{sessionDate}} at {{fromTime}}.',
      deepLink: '/bookings',
    },
    INSTRUCTOR: {
      title: 'Session tomorrow',
      body: 'You have a session on {{sessionDate}} at {{fromTime}}.',
      deepLink: '/instructor/schedule',
    },
  },
  'session.reminder_2h': {
    CUSTOMER: {
      title: 'Session in 2 hours',
      body: '{{instructorName}} arrives at {{fromTime}} today.',
      deepLink: '/bookings',
    },
    INSTRUCTOR: {
      title: 'Session in 2 hours',
      body: 'Your session starts at {{fromTime}} today.',
      deepLink: '/instructor/today',
    },
  },
  'session.reminder_30m': {
    CUSTOMER: {
      title: 'Session in 30 minutes',
      body: 'Your session starts at {{fromTime}}.',
      deepLink: '/bookings',
    },
    INSTRUCTOR: {
      title: 'Session in 30 minutes',
      body: 'Time to head out — your session starts at {{fromTime}}.',
      deepLink: '/instructor/today',
    },
  },
  'session.travel_started': {
    CUSTOMER: {
      title: '{{instructorName}} is on the way',
      body: 'Arriving in about {{etaMinutes}} minutes.',
      deepLink: '/bookings',
    },
    ADMIN: {
      title: 'Teacher en route',
      body: '{{instructorName}} started travel, ETA {{etaMinutes}} min.',
      deepLink: '/admin/live-board',
    },
  },
  'session.checked_in': {
    CUSTOMER: {
      title: 'Session started',
      body: '{{instructorName}} checked in at {{checkInAt}}.',
      deepLink: '/bookings',
    },
    INSTRUCTOR: {
      title: 'Checked in',
      body: 'Check-in recorded at {{checkInAt}}.',
      deepLink: '/instructor/today',
    },
    ADMIN: {
      title: 'Check-in',
      body: '{{instructorName}} checked in at {{checkInAt}}.',
      deepLink: '/admin/live-board',
    },
  },
  'session.check_in_late': {
    CUSTOMER: {
      title: 'Running late',
      body: 'Your {{fromTime}} session has not started yet. We are following up with {{instructorName}}.',
      deepLink: '/bookings',
    },
    INSTRUCTOR: {
      title: 'Check in now',
      body: 'Your {{fromTime}} session is {{minutesLate}} minutes late. Please check in.',
      deepLink: '/instructor/today',
    },
    ADMIN: {
      title: 'Late check-in',
      body: '{{instructorName}} is {{minutesLate}} min late for {{fromTime}}.',
      deepLink: '/admin/live-board',
    },
  },
  'session.completed': {
    CUSTOMER: {
      title: 'Session complete',
      body: 'Your {{serviceName}} session on {{sessionDate}} is complete. Tell us how it went.',
      deepLink: '/reviews/new',
    },
    INSTRUCTOR: {
      title: 'Session complete',
      body: '₹{{earning}} added to your earnings for {{sessionDate}}.',
      deepLink: '/instructor/earnings',
    },
  },
  'session.rescheduled': {
    CUSTOMER: {
      title: 'Reschedule {{outcome}}',
      body: '{{bookingCode}} moved from {{oldDate}} to {{newDate}} at {{newFromTime}}.',
      deepLink: '/bookings/{{bookingCode}}',
    },
    INSTRUCTOR: {
      title: 'Session rescheduled',
      body: 'Now {{newDate}} at {{newFromTime}}.',
      deepLink: '/instructor/schedule',
    },
    ADMIN: {
      title: 'Reschedule {{outcome}}',
      body: '{{bookingCode}}: {{oldDate}} to {{newDate}}.',
      deepLink: '/admin/bookings/{{bookingCode}}',
    },
  },
  'session.cancelled': {
    CUSTOMER: {
      title: 'Session cancelled',
      body: 'Your {{sessionDate}} session was cancelled by {{cancelledBy}}. Refund: ₹{{refundAmount}}.',
      deepLink: '/bookings/{{bookingCode}}',
    },
    INSTRUCTOR: {
      title: 'Session cancelled',
      body: 'Your {{sessionDate}} session was cancelled.',
      deepLink: '/instructor/schedule',
    },
    ADMIN: {
      title: 'Cancellation',
      body: '{{bookingCode}} cancelled by {{cancelledBy}}, refund ₹{{refundAmount}}.',
      deepLink: '/admin/bookings/{{bookingCode}}',
    },
  },

  'refund.initiated': {
    CUSTOMER: {
      title: 'Refund initiated',
      body: '₹{{amount}} for {{bookingCode}} is on its way to your {{mode}}.',
      deepLink: '/bookings/{{bookingCode}}',
    },
    ADMIN: {
      title: 'Refund initiated',
      body: '₹{{amount}} for {{bookingCode}} via {{mode}}.',
      deepLink: '/admin/refunds',
    },
  },
  'refund.completed': {
    CUSTOMER: {
      title: 'Refund complete',
      body: '₹{{amount}} for {{bookingCode}} has been refunded to your {{mode}}.',
      deepLink: '/bookings/{{bookingCode}}',
    },
    ADMIN: {
      title: 'Refund complete',
      body: '₹{{amount}} for {{bookingCode}} settled via {{mode}}.',
      deepLink: '/admin/refunds',
    },
  },
  'wallet.credited': {
    CUSTOMER: {
      title: 'Wallet credited',
      body: '₹{{amount}} added ({{reason}}). Balance ₹{{balance}}.',
      deepLink: '/wallet',
    },
  },
  'payout.paid': {
    INSTRUCTOR: {
      title: 'Payout sent',
      body: '₹{{net}} for {{cycleFrom}}–{{cycleTo}} has been transferred. UTR {{utr}}.',
      deepLink: '/instructor/payouts',
    },
  },
  'payout.failed': {
    INSTRUCTOR: {
      title: 'Payout failed',
      body: 'Your {{cycleFrom}}–{{cycleTo}} payout could not be transferred. {{reason}}',
      deepLink: '/instructor/payouts',
    },
    ADMIN: {
      title: 'Payout failed',
      body: '{{cycleFrom}}–{{cycleTo}}: {{reason}}',
      deepLink: '/admin/payouts',
    },
  },

  'review.requested': {
    CUSTOMER: {
      title: 'How was your session?',
      body: 'Rate {{counterpartyName}} for your {{sessionDate}} session.',
      deepLink: '/reviews/new',
    },
    INSTRUCTOR: {
      title: 'Rate your session',
      body: 'Share feedback on {{counterpartyName}} for {{sessionDate}}.',
      deepLink: '/instructor/reviews/new',
    },
  },
  'review.published': {
    CUSTOMER: {
      title: 'Review published',
      body: 'Your {{sessionDate}} review is now visible.',
      deepLink: '/reviews',
    },
    INSTRUCTOR: {
      title: 'New review',
      body: 'You received {{rating}} stars for {{sessionDate}}.',
      deepLink: '/instructor/reviews',
    },
  },
  'review.low_rating': {
    INSTRUCTOR: {
      title: 'Low rating received',
      body: '{{rating}} stars for your {{sessionDate}} session. Support may be in touch.',
      deepLink: '/instructor/reviews',
    },
    ADMIN: {
      title: 'Low rating',
      body: '{{instructorName}} received {{rating}} stars on {{sessionDate}}.',
      deepLink: '/admin/reviews',
    },
  },
  'review.flagged': {
    CUSTOMER: {
      title: 'Review under review',
      body: 'Your review is being checked. {{reason}}',
      deepLink: '/reviews',
    },
    INSTRUCTOR: {
      title: 'Review under review',
      body: 'A review on your profile is being checked. {{reason}}',
      deepLink: '/instructor/reviews',
    },
    ADMIN: {
      title: 'Review flagged',
      body: '{{reason}}',
      deepLink: '/admin/reviews/moderation',
    },
  },

  'onboarding.stage_changed': {
    INSTRUCTOR: {
      title: 'Application update',
      body: 'Your application is now at {{stage}}. {{reason}}',
      deepLink: '/instructor/application',
    },
    ADMIN: {
      title: 'Application update',
      body: 'Applicant moved to {{stage}}.',
      deepLink: '/admin/instructors',
    },
  },
  'document.verified': {
    INSTRUCTOR: {
      title: 'Document verified',
      body: 'Your {{docType}} has been verified.',
      deepLink: '/instructor/documents',
    },
    ADMIN: {
      title: 'Document verified',
      body: '{{docType}} verified.',
      deepLink: '/admin/instructors',
    },
  },
  'document.rejected': {
    INSTRUCTOR: {
      title: 'Document needs attention',
      body: 'Your {{docType}} was not accepted: {{remarks}} Please upload it again.',
      deepLink: '/instructor/documents',
    },
    ADMIN: {
      title: 'Document rejected',
      body: '{{docType}}: {{remarks}}',
      deepLink: '/admin/instructors',
    },
  },
  'document.expiring': {
    INSTRUCTOR: {
      title: 'Document expiring',
      body: 'Your {{docType}} expires on {{expiryDate}} ({{daysLeft}} days). Upload a new one to keep taking sessions.',
      deepLink: '/instructor/documents',
    },
    ADMIN: {
      title: 'Document expiring',
      body: '{{docType}} expires {{expiryDate}} ({{daysLeft}} days).',
      deepLink: '/admin/instructors',
    },
  },
  'leave.decided': {
    INSTRUCTOR: {
      title: 'Leave {{outcome}}',
      body: 'Your leave from {{fromDate}} to {{toDate}} was {{outcome}}.',
      deepLink: '/instructor/leave',
    },
  },

  'membership.expiring': {
    CUSTOMER: {
      title: 'Membership {{outcome}}',
      body: 'Your {{planName}} plan {{outcome}} on {{expiresOn}}.',
      deepLink: '/membership',
    },
    ADMIN: {
      title: 'Membership {{outcome}}',
      body: '{{planName}}, {{expiresOn}}.',
      deepLink: '/admin/memberships',
    },
  },
  'campaign.broadcast': {
    CUSTOMER: {
      title: '{{title}}',
      body: '{{message}} Use code {{couponCode}}.',
      deepLink: '/offers',
    },
  },
};
