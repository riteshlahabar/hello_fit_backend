import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserStatus } from '../../../generated/prisma/enums';

/**
 * Password rule for admin accounts. Longer than the usual 8 because an admin
 * password protects every customer record behind it, and the admin login is a
 * plain email/password route reachable from the internet.
 */
const STRONG_PASSWORD =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;
const PASSWORD_MESSAGE =
  'password must be at least 12 characters and include an upper-case letter, a lower-case letter, a digit and a symbol';

export class ListAdminUsersQueryDto {
  /** Matches name or email. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean = false;

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

export class CreateAdminUserDto {
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s]{7,20}$/, { message: 'mobile must be a phone number' })
  mobile?: string;

  @IsString()
  @Matches(STRONG_PASSWORD, { message: PASSWORD_MESSAGE })
  password!: string;

  @IsUUID()
  roleId!: string;

  /** Null/omitted means all branches — head office. */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

/**
 * `password` is absent on purpose — resetting someone's password is its own
 * route, so a careless PATCH of the profile form cannot silently change
 * credentials. `email` is absent too: it is the login identifier and the audit
 * trail's human anchor.
 */
export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s]{7,20}$/, { message: 'mobile must be a phone number' })
  mobile?: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ChangeAdminStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

/** An admin resetting another admin's password. */
export class ResetAdminPasswordDto {
  @IsString()
  @Matches(STRONG_PASSWORD, { message: PASSWORD_MESSAGE })
  password!: string;
}

/** An admin changing their own, which requires the current one. */
export class ChangeOwnPasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @Matches(STRONG_PASSWORD, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lower-case words separated by hyphens',
  })
  @MaxLength(80)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Permission ids. Omit to create the role with none. */
  @IsOptional()
  @IsUUID('4', { each: true })
  permissionIds?: string[];
}

/** `slug` is absent: tokens and seeds key off it, so it is immutable. */
export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/** Replaces the role's permission set wholesale. */
export class SetRolePermissionsDto {
  @IsUUID('4', { each: true })
  permissionIds!: string[];
}
