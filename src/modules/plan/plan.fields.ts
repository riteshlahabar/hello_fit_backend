import type { Prisma } from '../../generated/prisma/client';
import type { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

/**
 * The DTO's fields, named one by one, as Prisma input.
 *
 * Spreading the DTO (`{ ...dto, slug }`) worked and read better, but it is a
 * class instance — `no-misused-spread` flags it, and the rule has a point
 * beyond the prototype: a spread forwards whatever happens to be on the
 * object, so a field added to the DTO later would reach the database without
 * anyone deciding it should.
 *
 * `undefined` is omitted by Prisma, so an absent optional leaves the column
 * alone on an update and takes the schema default on a create. That is why
 * every field can be listed unconditionally.
 */
/** The plain shape, so a create and an update can share it. */
interface PlanFieldValues {
  name?: string;
  icon?: string;
  eyebrow?: string;
  description?: string;
  priceMonthly?: number;
  priceYearly?: number;
  billingCaption?: string;
  isPopular?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

export function planFields(dto: CreatePlanDto | UpdatePlanDto): PlanFieldValues {
  return {
    name: dto.name,
    icon: dto.icon,
    eyebrow: dto.eyebrow,
    description: dto.description,
    priceMonthly: dto.priceMonthly,
    priceYearly: dto.priceYearly,
    billingCaption: dto.billingCaption,
    isPopular: dto.isPopular,
    sortOrder: dto.sortOrder,
    isActive: dto.isActive,
  };
}

/** The same, for a create, where `name` and `slug` are required. */
export function planCreateFields(
  dto: CreatePlanDto,
  slug: string,
): Prisma.PlanUncheckedCreateInput {
  return { ...planFields(dto), name: dto.name, slug };
}
