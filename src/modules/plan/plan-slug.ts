/**
 * The URL-safe spelling of a plan's name.
 *
 * Derived rather than sent by the client, so "Plus" cannot arrive as `plus`
 * from the admin form and `Plus` from a seed and become two plans. The caller
 * passes a uniqueness check because collisions are a database question, not a
 * string question.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * A free slug, given one that may be taken. `exists` answers for the database.
 *
 * Tries `plus`, then `plus-2`, `plus-3`. Bounded at 50 so a broken `exists`
 * cannot spin forever — it throws instead, which is loud and findable.
 */
export async function uniqueSlug(
  name: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(name) || 'plan';

  for (let n = 1; n <= 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }

  throw new Error(`Could not find a free slug for "${name}" after 50 tries`);
}
