import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomerService } from './customer.service';
import { PHOTO_MAX_BYTES } from './customer-photo';
import {
  CustomerPhotoService,
  type UploadedPhoto,
} from './customer-photo.service';
import {
  AllowAudience,
  CurrentUser,
  Roles,
} from '../../common/decorators/auth.decorators';
import {
  CreateAddressDto,
  UpdateAddressDto,
  UpdateCustomerProfileDto,
} from './dto/customer.dto';

/**
 * Customer profile and saved addresses.
 *
 * Every route resolves the caller's profile from the token — no id is accepted
 * from the payload or the path for ownership, so one customer cannot read or
 * edit another's address by guessing a UUID. `:addressId` is validated as a
 * UUID before it reaches a `@db.Uuid` column; a malformed one used to 500.
 */
@Controller('app/customer')
@AllowAudience('app')
@Roles('CUSTOMER')
export class CustomerController {
  constructor(
    private readonly customers: CustomerService,
    private readonly photos: CustomerPhotoService,
  ) {}

  // ----------------------------------------------------------------- profile

  @Get('profile')
  async getProfile(@CurrentUser('id') userId: string) {
    return { data: await this.customers.getProfile(userId) };
  }

  @Patch('profile')
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCustomerProfileDto,
  ) {
    return {
      data: await this.customers.updateProfile(userId, dto),
      message: 'Profile updated',
    };
  }

  /**
   * Multipart upload of the customer's own profile photo: one part, `file`.
   *
   * Memory storage, like the teacher's document route — the bytes go straight
   * to the storage port, so writing them to a temp file first would only add a
   * path to clean up. `fileSize` here is the interceptor's hard stop; the
   * friendlier message comes from `assertUploadablePhoto`.
   *
   * A POST and not a PATCH: there is one photo, and sending a new one replaces
   * it outright rather than merging anything.
   */
  @Post('profile/photo')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
    }),
  )
  async uploadPhoto(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: UploadedPhoto,
  ) {
    return {
      data: await this.photos.replacePhoto(userId, file),
      message: 'Profile photo updated',
    };
  }

  /** Removes the photo. The customer's initials are shown again. */
  @Delete('profile/photo')
  @HttpCode(200)
  async deletePhoto(@CurrentUser('id') userId: string) {
    return {
      data: await this.photos.removePhoto(userId),
      message: 'Profile photo removed',
    };
  }

  // --------------------------------------------------------------- addresses

  @Get('addresses')
  async listAddresses(@CurrentUser('id') userId: string) {
    const addresses = await this.customers.listAddresses(userId);
    return { data: addresses, meta: { count: addresses.length } };
  }

  @Get('addresses/:addressId')
  async getAddress(
    @CurrentUser('id') userId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return { data: await this.customers.getAddress(userId, addressId) };
  }

  @Post('addresses')
  async createAddress(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAddressDto,
  ) {
    return {
      data: await this.customers.createAddress(userId, dto),
      message: 'Address saved',
    };
  }

  @Patch('addresses/:addressId')
  async updateAddress(
    @CurrentUser('id') userId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return {
      data: await this.customers.updateAddress(userId, addressId, dto),
      message: 'Address updated',
    };
  }

  /** Exactly one address is the default; this moves the flag atomically. */
  @Post('addresses/:addressId/default')
  @HttpCode(200)
  async setDefaultAddress(
    @CurrentUser('id') userId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return {
      data: await this.customers.setDefaultAddress(userId, addressId),
      message: 'Default address updated',
    };
  }

  /** Soft delete. Refused while a session is still scheduled there. */
  @Delete('addresses/:addressId')
  @HttpCode(200)
  async deleteAddress(
    @CurrentUser('id') userId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    await this.customers.deleteAddress(userId, addressId);
    return { data: { id: addressId, deleted: true }, message: 'Address removed' };
  }
}
