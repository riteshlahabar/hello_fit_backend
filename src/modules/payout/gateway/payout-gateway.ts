/**
 * The port every payout rail implements. The spec names RazorpayX but requires
 * the same pluggability as the payment gateway, so nothing outside this folder
 * may mention a provider.
 *
 * Note this is the *outbound* direction — money leaving to a teacher — which is
 * why it is a separate port from `PAYMENT_GATEWAY` and not another method on
 * it. The two have different credentials, different failure modes (a payout can
 * be reversed by the bank days later) and in RazorpayX's case a different API
 * entirely.
 */
export const PAYOUT_GATEWAY = Symbol('PAYOUT_GATEWAY');

export interface PayoutTransferRequest {
  /** Our payout id, so the provider's dashboard is reconcilable. */
  reference: string;
  amount: number;
  currency: string;
  beneficiary: {
    name: string;
    /** Encrypted at rest and decrypted only here (spec 10.1). */
    accountNumber?: string;
    ifsc?: string;
    upiId?: string;
  };
  narration?: string;
}

export interface PayoutTransferResult {
  /** The provider's transfer id, or null for a rail that has none. */
  transferId: string | null;
  /**
   * What the payout's status should become. A real rail returns `PROCESSING`
   * and settles asynchronously; a manual rail returns `INITIATED` and waits for
   * a human to confirm.
   */
  status: 'INITIATED' | 'PROCESSING' | 'PAID' | 'FAILED';
  /** Bank reference, if the rail settles synchronously. */
  utr?: string;
  failureReason?: string;
  raw?: Record<string, unknown>;
}

export interface PayoutGateway {
  readonly name: string;

  /**
   * True when this rail moves the money itself. False means a human does, and
   * the UTR is entered by hand — which changes what the admin screen shows, so
   * it is part of the contract rather than something callers infer from `name`.
   */
  readonly isAutomated: boolean;

  transfer(request: PayoutTransferRequest): Promise<PayoutTransferResult>;
}
