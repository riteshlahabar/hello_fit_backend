import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AllowAudience,
  CurrentUser,
  RequirePermissions,
} from '../../common/decorators/auth.decorators';
import { MastersService, type AdminActor } from './masters.service';
import {
  BulkCreatePincodesDto,
  CreateAreaDto,
  CreateBranchDto,
  CreateCityDto,
  CreateHolidayDto,
  CreateLanguageDto,
  CreatePincodeDto,
  ListAreasQueryDto,
  ListBranchesQueryDto,
  ListHolidaysQueryDto,
  ListMastersQueryDto,
  ListPincodesQueryDto,
  UpdateAreaDto,
  UpdateBranchDto,
  UpdateCityDto,
  UpdateHolidayDto,
  UpdateLanguageDto,
  UpdatePincodeDto,
} from './dto/masters.dto';

/**
 * Geography, language and holiday masters (spec 5.7).
 *
 * Reads need `masters:view`, writes `masters:create` / `masters:edit` /
 * `masters:delete`. Only Super Admin holds the `masters` module by default
 * (seed, spec 5.8) — these rows decide where the business operates, and a
 * mis-set area silently removes a city from search.
 *
 * On an `/admin/*` route `@CurrentUser('id')` is already the `AdminUser.id`:
 * `auth.adminLogin` signs `sub: admin.id` and AdminUser is standalone, with no
 * `User` row behind it.
 */
@Controller('admin/masters')
@AllowAudience('admin')
export class AdminMastersController {
  constructor(private readonly masters: MastersService) {}

  private actorOf(adminUserId: string, req: Request): AdminActor {
    return {
      adminUserId,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string | undefined,
    };
  }

  // ------------------------------------------------------------------ cities

  @Get('cities')
  @RequirePermissions('masters:view')
  async listCities(@Query() query: ListMastersQueryDto) {
    const { rows, meta } = await this.masters.listCities(query);
    return { data: rows, meta };
  }

  @Get('cities/:id')
  @RequirePermissions('masters:view')
  async getCity(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.masters.getCity(id) };
  }

  @Post('cities')
  @RequirePermissions('masters:create')
  async createCity(
    @Body() dto: CreateCityDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.createCity(dto, this.actorOf(adminUserId, req)),
      message: 'City created',
    };
  }

  @Patch('cities/:id')
  @RequirePermissions('masters:edit')
  async updateCity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCityDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.updateCity(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'City updated',
    };
  }

  @Delete('cities/:id')
  @RequirePermissions('masters:delete')
  @HttpCode(HttpStatus.OK)
  async deleteCity(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.deleteCity(id, this.actorOf(adminUserId, req)),
      message: 'City retired',
    };
  }

  // ------------------------------------------------------------------- areas

  @Get('areas')
  @RequirePermissions('masters:view')
  async listAreas(@Query() query: ListAreasQueryDto) {
    const { rows, meta } = await this.masters.listAreas(query);
    return { data: rows, meta };
  }

  @Get('areas/:id')
  @RequirePermissions('masters:view')
  async getArea(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.masters.getArea(id) };
  }

  @Post('areas')
  @RequirePermissions('masters:create')
  async createArea(
    @Body() dto: CreateAreaDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.createArea(dto, this.actorOf(adminUserId, req)),
      message: 'Service area created',
    };
  }

  @Patch('areas/:id')
  @RequirePermissions('masters:edit')
  async updateArea(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAreaDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.updateArea(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Service area updated',
    };
  }

  @Delete('areas/:id')
  @RequirePermissions('masters:delete')
  @HttpCode(HttpStatus.OK)
  async deleteArea(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.deleteArea(id, this.actorOf(adminUserId, req)),
      message: 'Service area retired',
    };
  }

  // ---------------------------------------------------------------- pincodes

  @Get('pincodes')
  @RequirePermissions('masters:view')
  async listPincodes(@Query() query: ListPincodesQueryDto) {
    const { rows, meta } = await this.masters.listPincodes(query);
    return { data: rows, meta };
  }

  @Post('pincodes')
  @RequirePermissions('masters:create')
  async createPincode(
    @Body() dto: CreatePincodeDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.createPincode(
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Pincode mapped',
    };
  }

  /** Paste a city launch's worth of codes at once. */
  @Post('pincodes/bulk')
  @RequirePermissions('masters:create')
  @HttpCode(HttpStatus.OK)
  async bulkCreatePincodes(
    @Body() dto: BulkCreatePincodesDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    const data = await this.masters.bulkCreatePincodes(
      dto,
      this.actorOf(adminUserId, req),
    );
    return { data, message: `${data.created} pincodes mapped` };
  }

  @Patch('pincodes/:id')
  @RequirePermissions('masters:edit')
  async updatePincode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePincodeDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.updatePincode(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Pincode updated',
    };
  }

  @Delete('pincodes/:id')
  @RequirePermissions('masters:delete')
  @HttpCode(HttpStatus.OK)
  async deletePincode(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.deletePincode(
        id,
        this.actorOf(adminUserId, req),
      ),
      message: 'Pincode unmapped',
    };
  }

  // ---------------------------------------------------------------- branches

  @Get('branches')
  @RequirePermissions('masters:view')
  async listBranches(@Query() query: ListBranchesQueryDto) {
    const { rows, meta } = await this.masters.listBranches(query);
    return { data: rows, meta };
  }

  @Get('branches/:id')
  @RequirePermissions('masters:view')
  async getBranch(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.masters.getBranch(id) };
  }

  @Post('branches')
  @RequirePermissions('masters:create')
  async createBranch(
    @Body() dto: CreateBranchDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.createBranch(
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Branch created',
    };
  }

  @Patch('branches/:id')
  @RequirePermissions('masters:edit')
  async updateBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.updateBranch(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Branch updated',
    };
  }

  @Delete('branches/:id')
  @RequirePermissions('masters:delete')
  @HttpCode(HttpStatus.OK)
  async deleteBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.deleteBranch(id, this.actorOf(adminUserId, req)),
      message: 'Branch retired',
    };
  }

  // --------------------------------------------------------------- languages

  @Get('languages')
  @RequirePermissions('masters:view')
  async listLanguages(@Query() query: ListMastersQueryDto) {
    const { rows, meta } = await this.masters.listLanguages(query);
    return { data: rows, meta };
  }

  @Post('languages')
  @RequirePermissions('masters:create')
  async createLanguage(
    @Body() dto: CreateLanguageDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.createLanguage(
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Language created',
    };
  }

  @Patch('languages/:id')
  @RequirePermissions('masters:edit')
  async updateLanguage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLanguageDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.updateLanguage(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Language updated',
    };
  }

  @Delete('languages/:id')
  @RequirePermissions('masters:delete')
  @HttpCode(HttpStatus.OK)
  async deleteLanguage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.deleteLanguage(
        id,
        this.actorOf(adminUserId, req),
      ),
      message: 'Language retired',
    };
  }

  // ---------------------------------------------------------------- holidays

  @Get('holidays')
  @RequirePermissions('masters:view')
  async listHolidays(@Query() query: ListHolidaysQueryDto) {
    const { rows, meta } = await this.masters.listHolidays(query);
    return { data: rows, meta };
  }

  @Post('holidays')
  @RequirePermissions('masters:create')
  async createHoliday(
    @Body() dto: CreateHolidayDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.createHoliday(
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Holiday added',
    };
  }

  @Patch('holidays/:id')
  @RequirePermissions('masters:edit')
  async updateHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.updateHoliday(
        id,
        dto,
        this.actorOf(adminUserId, req),
      ),
      message: 'Holiday updated',
    };
  }

  @Delete('holidays/:id')
  @RequirePermissions('masters:delete')
  @HttpCode(HttpStatus.OK)
  async deleteHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') adminUserId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.masters.deleteHoliday(
        id,
        this.actorOf(adminUserId, req),
      ),
      message: 'Holiday removed',
    };
  }
}
