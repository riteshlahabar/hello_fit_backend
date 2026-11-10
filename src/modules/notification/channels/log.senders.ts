import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  EmailMessage,
  EmailSender,
  PushMessage,
  PushSender,
  SendOutcome,
  SmsSender,
} from './channel.port';

/**
 * Development stand-ins that log instead of sending.
 *
 * They report `ok: true`, which is a deliberate choice: the point in
 * development is to exercise the outbox lifecycle — queued, rendered, marked
 * sent — not to simulate failure. A sender that always failed would leave every
 * row in `FAILED` and hide real bugs behind expected noise.
 *
 * `NotificationModule` refuses to boot into any of these in production, so
 * "ok" can never mean "silently discarded" on a real deployment.
 */

@Injectable()
export class LogPushSender implements PushSender {
  readonly name = 'log';
  private readonly logger = new Logger('Push:log');

  sendToTokens(
    tokens: string[],
    message: PushMessage,
  ): Promise<SendOutcome[]> {
    for (const token of tokens) {
      this.logger.log(
        `[${message.priority}] -> ${token.slice(0, 12)}…  ${message.title} | ${message.body}` +
          (message.deepLink ? `  deepLink=${message.deepLink}` : ''),
      );
    }
    return Promise.resolve(
      tokens.map(() => ({ ok: true, messageId: randomUUID() })),
    );
  }
}

@Injectable()
export class LogSmsSender implements SmsSender {
  readonly name = 'log';
  private readonly logger = new Logger('Sms:log');

  send(mobile: string, text: string): Promise<SendOutcome> {
    this.logger.log(`-> ${mobile}  ${text}`);
    return Promise.resolve({ ok: true, messageId: randomUUID() });
  }
}

@Injectable()
export class LogEmailSender implements EmailSender {
  readonly name = 'log';
  private readonly logger = new Logger('Email:log');

  send(address: string, message: EmailMessage): Promise<SendOutcome> {
    this.logger.log(`-> ${address}  [${message.subject}] ${message.body}`);
    return Promise.resolve({ ok: true, messageId: randomUUID() });
  }
}
