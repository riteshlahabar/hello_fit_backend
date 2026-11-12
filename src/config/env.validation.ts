import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Shape of the environment this app refuses to boot without. Validated once at
 * startup so a missing DATABASE_URL or JWT secret fails immediately instead of
 * surfacing as a confusing 500 on the first request that happens to need it.
 */
export class EnvVars {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /**
   * Interface to bind. `0.0.0.0` for local development, so a phone on the LAN
   * can reach the API while the Flutter apps are being built.
   *
   * **Set it to `127.0.0.1` on any shared or internet-facing host.** Behind
   * Nginx the app never needs a public socket, and a public one is a way past
   * whatever Nginx is enforcing — on the review VPS that is the IP allowlist,
   * and past it sits `POST /auth/otp/send` handing out OTP codes in
   * development. A host firewall is not a substitute: `ufw` was inactive on
   * that box, so `0.0.0.0:4000` would have been open to the internet.
   */
  @IsString()
  @IsNotEmpty()
  HOST: string = '0.0.0.0';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_TTL: string = '15m';

  @IsString()
  @MinLength(32, {
    message: 'JWT_REFRESH_SECRET must be at least 32 characters',
  })
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_TTL: string = '30d';

  // Payments. Optional in development: PaymentModule falls back to a
  // simulated gateway, and refuses to boot in production without these.
  @IsOptional()
  @IsString()
  RAZORPAY_KEY_ID?: string;

  @IsOptional()
  @IsString()
  RAZORPAY_KEY_SECRET?: string;

  @IsOptional()
  @IsString()
  RAZORPAY_WEBHOOK_SECRET?: string;

  // File storage. The local-disk stand-in writes KYC documents under this
  // directory in development; StorageModule refuses to boot into it in
  // production, where a private S3-compatible bucket is required.
  @IsOptional()
  @IsString()
  STORAGE_ROOT?: string;

  /**
   * Origin the signed download URLs are built on, e.g.
   * `https://api.hellofit.in`. Empty in development, which yields a relative
   * URL the app resolves against its own base.
   */
  @IsOptional()
  @IsString()
  PUBLIC_BASE_URL?: string;

  // Firebase Cloud Messaging (push). All three come from a service-account
  // JSON key. Optional in development: NotificationModule falls back to a
  // logging stand-in, and refuses to boot in production without them —
  // notifications written to a log instead of delivered is a failure nobody
  // notices for a week.
  @IsOptional()
  @IsString()
  FIREBASE_PROJECT_ID?: string;

  @IsOptional()
  @IsString()
  FIREBASE_CLIENT_EMAIL?: string;

  /**
   * The `private_key` field of the service-account JSON. Pasted into `.env` it
   * arrives with literal `\n` sequences, which `FcmPushSender` unescapes.
   */
  @IsOptional()
  @IsString()
  FIREBASE_PRIVATE_KEY?: string;
}

export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const parsed = plainToInstance(EnvVars, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(parsed, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  if (
    parsed.NODE_ENV === NodeEnv.Production &&
    parsed.JWT_ACCESS_SECRET === parsed.JWT_REFRESH_SECRET
  ) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ in production',
    );
  }

  return parsed;
}
