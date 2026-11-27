import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/**
 * The services a trainer says they deliver — page 15's second half.
 *
 * **The array is the whole set, not a delta** (`setInstructorServices`), so an
 * empty array is a legitimate payload meaning "I offer none of these any more".
 * The cap is a sanity bound on a multi-select, not a business rule: the live
 * catalogue is a handful of services per category.
 */
export class SetOwnServicesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  serviceIds!: string[];
}
