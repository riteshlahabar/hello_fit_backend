import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  NotificationAudience,
  NotificationChannel,
  NotificationStatus,
} from '../../../generated/prisma/enums';

export class ListInAppQueryDto {
  @IsOptional()
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * One opt-out. `eventKey` omitted means the whole channel.
 *
 * Only promotional events are actually suppressible — the service ignores a
 * preference set against a transactional one rather than rejecting it, so the
 * app can offer a single settings screen without knowing the taxonomy.
 */
export class SetPreferenceDto {
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  eventKey?: string;

  @IsBoolean()
  enabled!: boolean;
}

export class ListOutboxQueryDto {
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  eventKey?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/** Admin-editable copy. Validated against the event's declared variables. */
export class UpsertTemplateDto {
  @IsString()
  @MaxLength(80)
  eventKey!: string;

  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsEnum(NotificationAudience)
  audience!: NotificationAudience;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string = 'en';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsString()
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deepLink?: string;

  /** Provider template id, for SMS rails requiring pre-registered copy (DLT). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  providerRef?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Sends a test notification to the calling admin, to check copy and delivery. */
export class TestNotificationDto {
  @IsString()
  @MaxLength(80)
  eventKey!: string;

  @IsOptional()
  data?: Record<string, unknown>;
}
