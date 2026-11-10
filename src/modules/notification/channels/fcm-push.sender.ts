import { createSign } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../../config/env.validation';
import type {
  PushMessage,
  PushSender,
  SendOutcome,
} from './channel.port';

/**
 * Firebase Cloud Messaging over the **HTTP v1 API**, called with `fetch`.
 *
 * Why not `firebase-admin`: the same reasoning as Razorpay in the payment
 * module — the SDK is a large dependency tree for what is one authenticated
 * POST per message, and this project has kept its dependency surface small on
 * purpose. What the SDK would give us for free is the OAuth token cache and
 * the per-token error mapping, so both are implemented here deliberately
 * rather than skipped.
 *
 * Why HTTP v1 and not the legacy endpoint: the legacy `/fcm/send` API with a
 * server key is shut down. v1 needs a service-account OAuth2 token, which is
 * what `accessToken()` below mints.
 *
 * **One HTTP call per token.** FCM v1 removed the multicast endpoint; the SDK's
 * `sendEachForMulticast` is itself a loop. Sends run concurrently, and a
 * realistic fan-out is one to three devices per user.
 */
@Injectable()
export class FcmPushSender implements PushSender {
  readonly name = 'fcm';

  private readonly logger = new Logger(FcmPushSender.name);

  /** Cached OAuth2 token. FCM issues them for an hour; refreshed at 55 min. */
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService<EnvVars, true>) {}

  async sendToTokens(
    tokens: string[],
    message: PushMessage,
  ): Promise<SendOutcome[]> {
    if (tokens.length === 0) return [];

    const projectId = this.config.get('FIREBASE_PROJECT_ID', { infer: true });
    if (!projectId) {
      return tokens.map(() => ({
        ok: false,
        error: 'FCM is not configured (FIREBASE_PROJECT_ID missing)',
      }));
    }

    let accessToken: string;
    try {
      accessToken = await this.accessToken();
    } catch (error) {
      // A credentials failure is not the token's fault — every outcome is a
      // retryable failure, never a permanent one, or a bad service-account
      // key would wipe every device token in the database.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`FCM auth failed: ${reason}`);
      return tokens.map(() => ({ ok: false, error: `auth: ${reason}` }));
    }

    const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    return Promise.all(
      tokens.map((token) => this.sendOne(url, accessToken, token, message)),
    );
  }

  private async sendOne(
    url: string,
    accessToken: string,
    token: string,
    message: PushMessage,
  ): Promise<SendOutcome> {
    // `data` values must be strings — FCM rejects numbers and nested objects.
    const data: Record<string, string> = { ...message.data };
    if (message.deepLink) data.deepLink = message.deepLink;

    const body = {
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data,
        android: {
          priority: message.priority === 'high' ? 'HIGH' : 'NORMAL',
          notification: {
            // Lets the app replace an earlier notification for the same thing
            // rather than stacking five reminders for one session.
            tag: data.deepLink ?? message.title,
          },
        },
        apns: {
          headers: {
            // 10 = deliver immediately; 5 = may be delayed to save battery.
            'apns-priority': message.priority === 'high' ? '10' : '5',
          },
          payload: { aps: { sound: 'default' } },
        },
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const json = (await response.json()) as { name?: string };
        return { ok: true, messageId: json.name };
      }

      const text = await response.text();
      return {
        ok: false,
        error: `${response.status} ${text.slice(0, 300)}`,
        permanentFailure: this.isDeadToken(response.status, text),
      };
    } catch (error) {
      // Network-level failure: retryable, and definitely not the token's fault.
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Distinguishes "this token is gone for good" from "try again later". Getting
   * this wrong in either direction is costly: treating a transient 503 as
   * permanent deletes a live device, and treating `UNREGISTERED` as transient
   * retries a dead token forever and invites throttling.
   *
   * `UNREGISTERED` is the app being uninstalled or the token rotated;
   * `INVALID_ARGUMENT` on a send is a malformed token. 404 is the v1 code for
   * an unregistered token.
   */
  private isDeadToken(status: number, body: string): boolean {
    if (status === 404) return true;
    if (status !== 400) return false;
    return (
      body.includes('UNREGISTERED') ||
      body.includes('INVALID_ARGUMENT') ||
      body.includes('registration-token-not-registered')
    );
  }

  /**
   * Mints a Google OAuth2 access token from the service account, by signing a
   * JWT assertion and exchanging it. This is the whole of what
   * `firebase-admin` does for authentication.
   */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }

    const clientEmail = this.config.get('FIREBASE_CLIENT_EMAIL', {
      infer: true,
    });
    const rawKey = this.config.get('FIREBASE_PRIVATE_KEY', { infer: true });

    if (!clientEmail || !rawKey) {
      throw new Error(
        'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required for FCM',
      );
    }

    // A service-account key pasted into .env arrives with literal \n.
    const privateKey = rawKey.replace(/\\n/g, '\n');

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };

    const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(privateKey, 'base64url');

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `token exchange failed: ${response.status} ${(await response.text()).slice(0, 200)}`,
      );
    }

    const json = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.token = {
      value: json.access_token,
      // Refresh five minutes early so a send never races the expiry.
      expiresAt: Date.now() + (json.expires_in - 300) * 1000,
    };

    this.logger.debug('FCM access token refreshed');
    return this.token.value;
  }
}

function b64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
