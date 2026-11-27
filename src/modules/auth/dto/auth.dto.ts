import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { DevicePlatform, UserRole } from '../../../generated/prisma/enums';
import { OTP_LENGTH } from '../otp.service';

/** Indian mobile numbers, stored and compared in E.164-ish digits only. */
const MOBILE_PATTERN = /^[6-9]\d{9}$/;

export class SendOtpDto {
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\D/g, '').slice(-10) : value,
  )
  @Matches(MOBILE_PATTERN, { message: 'mobile must be a valid 10-digit number' })
  mobile!: string;
}

export class DeviceInfoDto {
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  fcmToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}

export class VerifyOtpDto extends SendOtpDto {
  @IsString()
  @Length(OTP_LENGTH, OTP_LENGTH)
  @Matches(/^\d+$/, { message: 'code must be numeric' })
  code!: string;

  /**
   * Optional so a web login works; the app always sends it. ValidateNested +
   * Type are both required, or the global whitelisting pipe silently drops the
   * nested object instead of validating it.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device?: DeviceInfoDto;

  /**
   * Which app is signing in, and so which profile a first login creates
   * (client, 27-11-2026). The trainer app sends INSTRUCTOR, so a trainer
   * registration lands in `instructor_profiles` and shows in the admin
   * panel's trainer list, not its customer list.
   *
   * Optional and CUSTOMER by default: the customer app and the website both
   * omit it, and so does every older build still in someone's hands.
   */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class AdminLoginDto {
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
