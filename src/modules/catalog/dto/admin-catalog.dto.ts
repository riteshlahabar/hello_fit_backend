import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Shared list filters, same page/limit convention as the other admin tables. */
export class ListCatalogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean = false;

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

/** The service list adds a category filter. */
export class ListServicesQueryDto extends ListCatalogQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

/**
 * PDF 6.5: "create fitness categories", "maintain category descriptions".
 * The slug is derived from the name, not typed — it is a URL key, and two
 * people typing it by hand is how a catalogue ends up with `power-yoga` and
 * `poweryoga` pointing at different rows.
 */
export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  icon?: string;


  /**
   * Card image for the category, shown on the website home grid. A URL
   * rather than an upload: the supplied design uses hosted images, and the
   * public GET /categories has always returned this column — it simply had
   * no way in. Client instruction, 11 Nov 2026.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** PDF 6.5: "edit category information", "activate or deactivate categories". */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  icon?: string;


  /**
   * Card image for the category, shown on the website home grid. A URL
   * rather than an upload: the supplied design uses hosted images, and the
   * public GET /categories has always returned this column — it simply had
   * no way in. Client instruction, 11 Nov 2026.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * PDF 6.5: "manage permitted service visibility". The admin does **not** edit
 * a service — 4.5 gives the provider its name, description and pricing. The
 * only administrative lever on a service is whether customers can see it.
 */
export class SetServiceVisibilityDto {
  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
