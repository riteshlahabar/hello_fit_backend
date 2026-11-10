/**
 * Outbox retry schedule. Pure.
 *
 * Exponential-ish rather than a fixed interval: a dead FCM token or a provider
 * outage should not be hammered once a minute for an hour, but a transient
 * network blip should clear on the next tick.
 *
 * The ceiling matters more than the curve. A notification nobody could be sent
 * after four attempts over about two and a half hours is stale — a 2-hour
 * session reminder delivered six hours late is worse than not delivered, so the
 * row goes `FAILED` and stays visible in the admin outbox rather than retrying
 * forever.
 */

/** Delay before attempt N+1, having just failed attempt N (1-based). */
const SCHEDULE_MS = [
  60_000, //      1 min
  300_000, //     5 min
  1_800_000, //  30 min
  7_200_000, //   2 h
] as const;

/**
 * Total attempts allowed, not the number of delays: the schedule holds the gaps
 * *between* attempts, so four gaps permit five sends. Conflating the two is an
 * off-by-one that silently drops the last retry.
 */
export const MAX_ATTEMPTS = SCHEDULE_MS.length + 1;

export function nextAttemptDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), SCHEDULE_MS.length) - 1;
  return SCHEDULE_MS[index];
}

export function shouldRetry(attempts: number): boolean {
  return attempts < MAX_ATTEMPTS;
}

export function nextAttemptAt(attempts: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + nextAttemptDelayMs(attempts));
}
