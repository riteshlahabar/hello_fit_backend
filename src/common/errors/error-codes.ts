/**
 * Stable, machine-readable error codes. The Flutter app and admin panel switch
 * on these to show localised messages, so **never rename or reuse a code** —
 * add a new one instead. The HTTP status carries the category; the code carries
 * the specific cause.
 */
export const ErrorCode = {
  // Generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // Auth
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',

  // Data
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  FOREIGN_KEY_VIOLATION: 'FOREIGN_KEY_VIOLATION',

  // Profile and addresses
  PROFILE_EXISTS: 'PROFILE_EXISTS',
  PROFILE_REQUIRED: 'PROFILE_REQUIRED',
  ADDRESS_LIMIT_REACHED: 'ADDRESS_LIMIT_REACHED',
  /** An upcoming session is still scheduled at this address. */
  ADDRESS_IN_USE: 'ADDRESS_IN_USE',

  // Teacher onboarding and KYC
  /** The caller has no InstructorProfile; they have not applied. */
  NOT_AN_APPLICANT: 'NOT_AN_APPLICANT',
  /** An application already exists for this account. */
  APPLICATION_EXISTS: 'APPLICATION_EXISTS',
  /** Profile or documents incomplete; the response carries the reasons. */
  ONBOARDING_INCOMPLETE: 'ONBOARDING_INCOMPLETE',
  /** The requested onboarding stage is not reachable from the current one. */
  STAGE_TRANSITION_INVALID: 'STAGE_TRANSITION_INVALID',
  /** The application is not in a stage that accepts this change. */
  ONBOARDING_STAGE_LOCKED: 'ONBOARDING_STAGE_LOCKED',
  DOCUMENT_TOO_LARGE: 'DOCUMENT_TOO_LARGE',
  DOCUMENT_TYPE_NOT_ALLOWED: 'DOCUMENT_TYPE_NOT_ALLOWED',
  /** A verified document cannot be replaced or deleted by the teacher. */
  DOCUMENT_LOCKED: 'DOCUMENT_LOCKED',

  // Files
  /** A signed download link that is expired, tampered with or never valid. */
  FILE_LINK_INVALID: 'FILE_LINK_INVALID',

  // Payouts
  /** The requested payout status is not reachable from the current one. */
  PAYOUT_TRANSITION_INVALID: 'PAYOUT_TRANSITION_INVALID',
  /** Only a DRAFT payout can be edited or deleted. */
  PAYOUT_NOT_EDITABLE: 'PAYOUT_NOT_EDITABLE',
  /** A batch already exists for this teacher and cycle. */
  PAYOUT_CYCLE_EXISTS: 'PAYOUT_CYCLE_EXISTS',
  /** Nothing payable in the cycle, or the total is under the minimum. */
  PAYOUT_NOTHING_TO_PAY: 'PAYOUT_NOTHING_TO_PAY',
  /** No verified bank details, so there is nowhere to send the money. */
  PAYOUT_NO_BENEFICIARY: 'PAYOUT_NO_BENEFICIARY',
  /** The earning is already in a payout batch. */
  EARNING_ALREADY_BATCHED: 'EARNING_ALREADY_BATCHED',
  /** The earning is not in a state this action allows. */
  EARNING_NOT_ADJUSTABLE: 'EARNING_NOT_ADJUSTABLE',

  // Masters
  /** Rows still reference this master, so it cannot be removed or deactivated. */
  MASTER_IN_USE: 'MASTER_IN_USE',
  /** The parent master is inactive or deleted, so a child cannot hang off it. */
  MASTER_PARENT_INACTIVE: 'MASTER_PARENT_INACTIVE',
  /** The last active default (e.g. the default language) cannot be cleared. */
  MASTER_DEFAULT_REQUIRED: 'MASTER_DEFAULT_REQUIRED',

  // Coupons (PDF 6.9)
  /** No such code, or the code is inactive, soft-deleted or outside its dates. */
  COUPON_INVALID: 'COUPON_INVALID',
  /** The code is real and live but the charge is under `minBookingAmount`. */
  COUPON_MIN_NOT_MET: 'COUPON_MIN_NOT_MET',
  /** The total or per-customer redemption limit is used up. */
  COUPON_LIMIT_REACHED: 'COUPON_LIMIT_REACHED',
  /** The code has been redeemed, so the code string itself is now frozen. */
  COUPON_ALREADY_REDEEMED: 'COUPON_ALREADY_REDEEMED',

  // Admin users, roles and permissions
  /** An admin cannot suspend, delete or demote their own account. */
  ADMIN_SELF_ACTION: 'ADMIN_SELF_ACTION',
  /** Removing this admin or role would leave no active super admin. */
  ADMIN_LAST_SUPER_ADMIN: 'ADMIN_LAST_SUPER_ADMIN',
  /** Built-in roles (`isSystem`) cannot be renamed or deleted. */
  ROLE_IS_SYSTEM: 'ROLE_IS_SYSTEM',
  /** Admin users are still assigned to this role. */
  ROLE_IN_USE: 'ROLE_IN_USE',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
