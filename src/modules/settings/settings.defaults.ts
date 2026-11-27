/**
 * Every value the spec calls "admin-configurable" lives here as a typed
 * default and is overridden by an AppSetting row. Nothing in the domain code
 * may hard-code these numbers — section 12 of the spec lists most of them as
 * still awaiting client confirmation, so they will change.
 */

/** Cancellation refund slabs (spec 3.5), as percentages of session value. */
export interface RefundSlabs {
  moreThan24hPercent: number;
  between2And24hPercent: number;
  lessThan2hPercent: number;
  afterCheckInPercent: number;
  /** Teacher- or admin-initiated cancellation. */
  providerCancelPercent: number;
  /** Goodwill wallet credit added when the provider cancels or no-shows. */
  providerCancelGoodwill: number;
  /** Charged to the customer on a no-show, as a percentage. */
  customerNoShowChargePercent: number;
}

/** Reschedule policy (spec 3.5). */
export interface ReschedulePolicy {
  freeBeyondHours: number;
  freeRescheduleCountWithin24h: number;
  blockedWithinHours: number;
}

/** Auto-assignment scoring weights (spec 3.3). Must total 100. */
export interface MatchingWeights {
  rating: number;
  distance: number;
  reliability: number;
  preferenceMatch: number;
  loadBalancing: number;
  continuity: number;
}

export interface AssignmentPolicy {
  weights: MatchingWeights;
  /** Minutes a teacher has to accept an offer before it cascades. */
  offerTimeoutMinutes: number;
  /** Failed offers before the session lands in the admin queue. */
  maxCascadeAttempts: number;
  /** Beyond this, distance scores zero. */
  maxDistanceKm: number;
}

export interface SchedulingPolicy {
  /** Minutes blocked either side of a session for travel. */
  defaultTravelBufferMin: number;
  /** Granularity of the slot grid shown to the customer. */
  slotGranularityMin: number;
  /** A slot must start at least this far in the future. */
  minLeadTimeMinutes: number;
  /** How far ahead the customer may book. */
  maxAdvanceDays: number;
  instituteOpenMinute: number;
  instituteCloseMinute: number;
  /** Grace after to-time before a session auto-completes (spec 3.4). */
  autoCompleteGraceMin: number;
  /** How long the teacher waits before a customer no-show may be marked. */
  noShowWaitMin: number;
  /**
   * Whether a provider must cover the session address's area to be offered.
   *
   * **Off until the provider app can set coverage** (client, 23-11-2026).
   * `instructor_service_areas` is read by `findSlots` and written by nothing —
   * PDF §4.2/US-P03 puts "enter service areas" in the provider app, which is
   * unbuilt — so with this on, every slot grid on every surface is empty by
   * construction and the customer reads it as "nobody is free". Turn it on
   * (an `app_settings` row, no code change) the day coverage is real data.
   */
  requireServiceArea: boolean;
}

export interface PaymentPolicy {
  /** Unpaid bookings expire and release their slots (spec 3.1). */
  slotHoldMinutes: number;
  taxPercent: number;
  /** Free travel radius; beyond it the distance slabs apply. */
  freeTravelRadiusKm: number;
  travelSlabs: { uptoKm: number; charge: number }[];
}

export interface PayoutPolicy {
  /** Dispute window before an earning becomes payable (spec 3.7). */
  disputeWindowHours: number;
  defaultCommissionPercent: number;
  tdsPercent: number;
  minimumPayoutAmount: number;
  /** 0 = Sunday. The weekly batch job runs on this day. */
  payoutCycleDay: number;
}

export interface ReviewPolicy {
  /** Double-blind publishing window (spec 4.4). */
  windowDays: number;
  /** How long the author may edit after submitting. */
  editLockHours: number;
  /** Ratings at or below this are auto-flagged for moderation. */
  autoFlagAtOrBelow: number;
  /** Two of these inside lowRatingWindowDays raises an ops alert (spec 4.6). */
  lowRatingThreshold: number;
  lowRatingWindowDays: number;
}

/** Customer account limits. */
export interface CustomerPolicy {
  /**
   * Saved addresses per customer. A cap at all is about abuse and about the
   * address picker staying usable, not storage.
   */
  maxAddresses: number;
}

/**
 * Teacher onboarding and KYC (spec 3.6). Which documents an applicant must
 * produce is a client policy decision — section 12 leaves "empanelled or
 * salaried" open, and a salaried model would drop the PAN and bank
 * requirements — so the list is configurable, never a constant in the code.
 */
export interface OnboardingPolicy {
  /** Must be uploaded before the applicant can submit for review. */
  requiredDocuments: string[];
  /**
   * Must be `VERIFIED` before the applicant can reach `APPROVED`. A subset of
   * `requiredDocuments`: a yoga certificate is checked by a human, an address
   * proof is not worth blocking approval on.
   */
  verificationRequired: string[];
  /** Pipeline steps that may be skipped — ops reality, not every hire demos. */
  screeningCallRequired: boolean;
  demoSessionRequired: boolean;
  /** Rejected by the upload endpoint, before anything is written. */
  maxFileSizeMb: number;
  allowedMimeTypes: string[];
  /** Lead time on the document-expiry reminder job. */
  expiryReminderDays: number;
  /** Signed download URLs for KYC files live this long (spec 10.1). */
  signedUrlTtlMinutes: number;
}

/**
 * Numbers the trainer app's own screens need and nothing else does. Both are
 * working assumptions — the client has set neither — and they live here
 * rather than in the service so agreeing a value is a config change.
 */
export interface TrainerAppPolicy {
  /** Page 38's Active / Inactive split: how stale a client may be. */
  clientActiveWindowDays: number;
  /** Page 57's bar chart: how many months of columns it draws. */
  earningsChartMonths: number;
}

export interface HelloFitSettings {
  refundSlabs: RefundSlabs;
  reschedulePolicy: ReschedulePolicy;
  assignment: AssignmentPolicy;
  scheduling: SchedulingPolicy;
  payment: PaymentPolicy;
  payout: PayoutPolicy;
  review: ReviewPolicy;
  customer: CustomerPolicy;
  onboarding: OnboardingPolicy;
  trainerApp: TrainerAppPolicy;
}

/**
 * Defaults taken from the spec. Where the spec leaves a value open (section
 * 12), the value here is a working assumption flagged for confirmation.
 */
export const DEFAULT_SETTINGS: HelloFitSettings = {
  refundSlabs: {
    moreThan24hPercent: 100,
    between2And24hPercent: 75,
    lessThan2hPercent: 50,
    afterCheckInPercent: 0,
    providerCancelPercent: 100,
    providerCancelGoodwill: 100,
    customerNoShowChargePercent: 100,
  },
  reschedulePolicy: {
    freeBeyondHours: 24,
    freeRescheduleCountWithin24h: 1,
    blockedWithinHours: 2,
  },
  assignment: {
    weights: {
      rating: 25,
      distance: 20,
      reliability: 20,
      preferenceMatch: 15,
      loadBalancing: 10,
      continuity: 10,
    },
    offerTimeoutMinutes: 10,
    maxCascadeAttempts: 3,
    maxDistanceKm: 25,
  },
  scheduling: {
    defaultTravelBufferMin: 30,
    slotGranularityMin: 30,
    minLeadTimeMinutes: 120,
    maxAdvanceDays: 60,
    instituteOpenMinute: 5 * 60,
    instituteCloseMinute: 22 * 60,
    autoCompleteGraceMin: 30,
    noShowWaitMin: 15,
    requireServiceArea: false,
  },
  payment: {
    slotHoldMinutes: 15,
    taxPercent: 18,
    freeTravelRadiusKm: 5,
    travelSlabs: [
      { uptoKm: 10, charge: 50 },
      { uptoKm: 15, charge: 100 },
      { uptoKm: 25, charge: 150 },
    ],
  },
  payout: {
    disputeWindowHours: 48,
    defaultCommissionPercent: 25,
    tdsPercent: 10,
    minimumPayoutAmount: 500,
    payoutCycleDay: 1,
  },
  review: {
    windowDays: 7,
    editLockHours: 24,
    autoFlagAtOrBelow: 1,
    lowRatingThreshold: 3,
    lowRatingWindowDays: 30,
  },
  customer: {
    maxAddresses: 10,
  },
  trainerApp: {
    /**
     * Page 38 splits the trainer's client list into Active and Inactive. A
     * client counts as active with an upcoming session, or a delivered one
     * inside this window. Working assumption — the client has not given a
     * number, and it is a setting so agreeing one is config, not code.
     */
    clientActiveWindowDays: 60,
    /** Page 57's chart: how many months of earnings the bars cover. */
    earningsChartMonths: 6,
  },
  onboarding: {
    // Working assumption: empanelled teachers, so PAN and bank details are
    // needed to pay them and police verification is needed to send them into
    // a customer's home. Confirm with the client (spec section 12).
    // No PHOTO here (client, 26-11-2026): the profile photo is taken on page
    // 12's basic information, so page 16 must not ask for it a second time.
    requiredDocuments: [
      'ID_PROOF',
      'ADDRESS_PROOF',
      'PAN',
      'BANK_DETAILS',
      'YOGA_CERTIFICATION',
      'POLICE_VERIFICATION',
    ],
    verificationRequired: [
      'ID_PROOF',
      'PAN',
      'BANK_DETAILS',
      'YOGA_CERTIFICATION',
      'POLICE_VERIFICATION',
    ],
    // Both off (client, 20-11-2026): the two middle steps were dropped, so
    // the pipeline is APPLIED -> DOCUMENTS_SUBMITTED -> APPROVED. An override
    // row in app_settings can switch either back on.
    screeningCallRequired: false,
    demoSessionRequired: false,
    maxFileSizeMb: 10,
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ],
    expiryReminderDays: 30,
    signedUrlTtlMinutes: 15,
  },
};

export type SettingsKey = keyof HelloFitSettings;
