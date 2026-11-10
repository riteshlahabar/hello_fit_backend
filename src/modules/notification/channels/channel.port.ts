/**
 * One port per delivery rail, not one fat `Notifier` interface — the spec asks
 * for FCM, an SMS provider and an email provider to be swappable
 * independently, and a module that only sends push should not depend on an
 * interface carrying `sendEmail`.
 *
 * Each returns a per-recipient result rather than throwing, because a push to
 * three devices where one token is dead is a partial success: the dead token
 * must be pruned and the other two count as delivered.
 */

export const PUSH_SENDER = Symbol('PUSH_SENDER');
export const SMS_SENDER = Symbol('SMS_SENDER');
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface SendOutcome {
  ok: boolean;
  /** Provider message id, for matching a later delivery report. */
  messageId?: string;
  error?: string;
  /**
   * The recipient address is permanently invalid — a dead FCM token, a number
   * that does not exist. The caller **deletes** it rather than retrying;
   * retrying a `UNREGISTERED` token forever is how a sender gets throttled.
   */
  permanentFailure?: boolean;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Route the app deep-links to when the notification is tapped. */
  deepLink?: string;
  /** Extra key/values delivered alongside. Values must be strings for FCM. */
  data?: Record<string, string>;
  priority: 'normal' | 'high';
}

export interface PushSender {
  readonly name: string;
  /**
   * Sends to many device tokens for one logical recipient. Returns one outcome
   * per token, in the same order, so the caller can prune exactly the dead
   * ones.
   */
  sendToTokens(
    tokens: string[],
    message: PushMessage,
  ): Promise<SendOutcome[]>;
}

export interface SmsSender {
  readonly name: string;
  send(mobile: string, text: string, templateRef?: string): Promise<SendOutcome>;
}

export interface EmailMessage {
  subject: string;
  body: string;
}

export interface EmailSender {
  readonly name: string;
  send(address: string, message: EmailMessage): Promise<SendOutcome>;
}
