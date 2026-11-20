import type { UpdateInstructorProfileDto } from './dto/instructor.dto';

/**
 * The address and professional-background columns added for the
 * trainer app's onboarding wizard (19 Nov 2026).
 *
 * Kept out of `InstructorService.updateOwnProfile` so that method stays about
 * the rules — the home-base pair, the editable-stage check — rather than a
 * dozen more `...(x !== undefined && { x })` lines. `undefined` means "not
 * sent, leave it"; an empty string means "clear it", which is why the test is
 * on `undefined` and not on truthiness.
 */
const CONTACT_KEYS = [
  'addressLine',
  'landmark',
  'city',
  'state',
  'pincode',
  'country',
  'qualification',
  'institute',
  'clientsTrainedBand',
  'serviceLocality',
] as const satisfies readonly (keyof UpdateInstructorProfileDto)[];

type ContactKey = (typeof CONTACT_KEYS)[number];

export function pickProfileContactFields(
  dto: UpdateInstructorProfileDto,
): Partial<Record<ContactKey, string | null>> {
  const data: Partial<Record<ContactKey, string | null>> = {};

  for (const key of CONTACT_KEYS) {
    const value = dto[key];
    if (value !== undefined) {
      // A trimmed-to-nothing field is a clear, not an empty string, so a
      // `WHERE city IS NOT NULL` search never matches a blank.
      data[key] = value.trim() === '' ? null : value.trim();
    }
  }

  return data;
}
