import {
  Body,
  Controller,
  Delete,
  Get,
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
import { AdminCatalogService, type AdminActor } from './admin-catalog.service';
import { AdminCatalogDeleteService } from './admin-catalog-delete.service';
import {
  CreateCategoryDto,
  ListCatalogQueryDto,
  UpdateCategoryDto,
} from './dto/admin-catalog.dto';

/**
 * Category management (PDF 6.5). The service routes share the
 * `admin/catalog` prefix from `AdminServiceController`.
 *
 * **Delete is hard and refused when anything points at the row** (client,
 * 18 Nov 2026): a category holding services is named with its count.
 * Deactivating is still there for a category with history.
 */
@Controller('admin/catalog')
@AllowAudience('admin')
export class AdminCatalogController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly deletes: AdminCatalogDeleteService,
  ) {}

  @Get('categories')
  @RequirePermissions('catalog:view')
  async listCategories(@Query() query: ListCatalogQueryDto) {
    const { rows, meta } = await this.catalog.listCategories(query);
    return { data: rows, meta };
  }

  @Post('categories')
  @RequirePermissions('catalog:create')
  async createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.catalog.createCategory(dto, this.actor(userId, req)),
      message: 'Category created',
    };
  }

  /** Also the activate / deactivate route — `isActive` is a field on it. */
  @Patch('categories/:id')
  @RequirePermissions('catalog:edit')
  async updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.catalog.updateCategory(id, dto, this.actor(userId, req)),
      message: 'Category updated',
    };
  }

  /**
   * Hard delete (client, 18 Nov 2026). A category holding services is
   * refused, naming the count: the services must go first, or the category
   * can be deactivated instead.
   */
  @Delete('categories/:id')
  @RequirePermissions('catalog:delete')
  async removeCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return {
      data: await this.deletes.deleteCategory(id, this.actor(userId, req)),
      message: 'Category deleted',
    };
  }

  private actor(userId: string, req: Request): AdminActor {
    return {
      adminUserId: userId,
      ipAddress: req.ip,
      requestId: req.headers['x-request-id'] as string | undefined,
    };
  }
}
