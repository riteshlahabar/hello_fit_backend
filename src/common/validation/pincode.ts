/**
 * Indian PIN code: six digits, never starting with zero.
 *
 * Shared because three places must agree on it — the address DTOs, the
 * serviceability lookup and the masters bulk-add. A second copy that drifts
 * would accept a code one surface can store and another cannot resolve.
 */
export const PINCODE_RE = /^[1-9][0-9]{5}$/;

export const PINCODE_MESSAGE = 'pincode must be a 6-digit Indian PIN code';
