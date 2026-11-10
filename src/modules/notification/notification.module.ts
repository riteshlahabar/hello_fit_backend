import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminNotificationController } from './admin-notification.controller';
import { NotificationController } from './notification.controller';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { FcmPushSender } from './channels/fcm-push.sender';
import {
  LogEmailSender,
  LogPushSender,
  LogSmsSender,
} from './channels/log.senders';
import {
  EMAIL_SENDER,
  PUSH_SENDER,
  SMS_SENDER,
} from './channels/channel.port';
import { NodeEnv, type EnvVars } from '../../config/env.validation';

/**
 * Picks a provider per channel, each independently.
 *
 * **Push is Firebase.** FCM when the service-account credentials are present,
 * otherwise the logging stand-in — and in production a missing credential is a
 * boot failure rather than a silent fallback, exactly as `PaymentModule` treats
 * a missing gateway key. A deployment that logs notifications instead of
 * sending them is worse than one that refuses to start, because nobody notices
 * for a week.
 *
 * SMS and email have **no provider yet** and log. They are allowed to log in
 * production for now: the spec leaves the SMS vendor open (section 12 lists the
 * gateway choice as unconfirmed), and India's DLT registration has to happen
 * before any provider will accept transactional templates. The boot warning
 * says so out loud. Replace each with one more implementation of its port.
 */
const pushProvider = {
  provide: PUSH_SENDER,
  inject: [ConfigService, FcmPushSender, LogPushSender],
  useFactory: (
    config: ConfigService<EnvVars, true>,
    fcm: FcmPushSender,
    log: LogPushSender,
  ) => {
    const logger = new Logger('Push');
    const configured = Boolean(
      config.get('FIREBASE_PROJECT_ID', { infer: true }) &&
        config.get('FIREBASE_CLIENT_EMAIL', { infer: true }) &&
        config.get('FIREBASE_PRIVATE_KEY', { infer: true }),
    );

    if (configured) {
      logger.log('Using Firebase Cloud Messaging (HTTP v1)');
      return fcm;
    }

    if (config.get('NODE_ENV', { infer: true }) === NodeEnv.Production) {
      throw new Error(
        'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY ' +
          'are required in production — push notifications would otherwise be ' +
          'written to the log and silently never delivered.',
      );
    }

    logger.warn('Using the logging push stand-in — nothing is delivered');
    return log;
  },
};

const smsProvider = {
  provide: SMS_SENDER,
  inject: [LogSmsSender],
  useFactory: (log: LogSmsSender) => {
    new Logger('Sms').warn(
      'No SMS provider configured — messages are logged. Pick a vendor and ' +
        'complete DLT registration before launch.',
    );
    return log;
  },
};

const emailProvider = {
  provide: EMAIL_SENDER,
  inject: [LogEmailSender],
  useFactory: (log: LogEmailSender) => {
    new Logger('Email').warn('No email provider configured — mail is logged.');
    return log;
  },
};

@Module({
  controllers: [NotificationController, AdminNotificationController],
  providers: [
    NotificationService,
    NotificationRepository,
    NotificationDispatchService,
    FcmPushSender,
    LogPushSender,
    LogSmsSender,
    LogEmailSender,
    pushProvider,
    smsProvider,
    emailProvider,
  ],
  // Exported so every other module can inject it and call `emit`.
  exports: [NotificationService],
})
export class NotificationModule {}
