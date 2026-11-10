/**
 * Template rendering for notifications. Pure, and the only place
 * `{{placeholder}}` syntax is understood.
 *
 * Pure because a notification is the one piece of output a customer sees that
 * nobody reviews before it ships: a template referencing a variable the caller
 * never supplies must be a failing test, not a text message reading
 * "Your session with {{instructorName}} is confirmed".
 */

export interface RenderResult {
  text: string;
  /** Placeholders the template used that `data` did not supply. */
  missing: string[];
}

/** `{{ name }}` — letters, digits, underscore and dot, with optional spaces. */
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/**
 * Substitutes placeholders, and reports the ones that were not supplied rather
 * than silently leaving the braces in. A missing value renders as an empty
 * string — a half-filled sentence reads better than visible template syntax,
 * and the `missing` list is what the caller logs or refuses on.
 *
 * Values are **not** HTML-escaped. These strings go to FCM, SMS and plain-text
 * email, none of which interpret markup. An HTML email body would need escaping
 * added here, at the point the channel is known.
 */
export function render(
  template: string,
  data: Record<string, unknown> = {},
): RenderResult {
  const missing: string[] = [];

  const text = template.replace(PLACEHOLDER, (_match, rawKey: string) => {
    const key = rawKey.trim();
    const value = lookup(data, key);

    if (value === undefined || value === null) {
      if (!missing.includes(key)) missing.push(key);
      return '';
    }
    return formatValue(value);
  });

  return { text, missing };
}

/** The placeholders a template references, in order of first appearance. */
export function placeholdersIn(template: string): string[] {
  const found: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const key = match[1].trim();
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

/**
 * Validates a template against an event's declared variables, for the admin
 * editor — so ops cannot save copy referencing a variable the event never
 * emits and only discover it when the event next fires.
 */
export function unknownPlaceholders(
  template: string,
  allowed: readonly string[],
): string[] {
  return placeholdersIn(template).filter(
    (key) => !allowed.includes(key.split('.')[0]),
  );
}

/** Supports `a.b` paths so nested `data` needs no flattening at the call site. */
function lookup(data: Record<string, unknown>, key: string): unknown {
  if (!key.includes('.')) return data[key];

  let current: unknown = data;
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * `Date` is rendered as a calendar date, not an ISO instant — a customer
 * reading "2026-11-07T00:00:00.000Z" in a text message is a bug. Everything
 * else is stringified as-is; callers pre-format money and times, because the
 * right format depends on locale and this module has no locale.
 */
function formatValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}
