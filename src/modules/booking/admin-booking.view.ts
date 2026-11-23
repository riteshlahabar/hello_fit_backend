/**
 * `dd-mm-yyyy` on the admin booking wire (hard rule 4; client, 23-11-2026 for
 * this screen).
 *
 * The two admin GET routes answered with raw Prisma rows, so every date left
 * as an ISO instant and the panel printed `new Date(…).toLocaleDateString()` —
 * the browser's locale, which is `mm/dd/yyyy` on a US-default machine. The
 * screen is what the client reported; the wire is what rule 4 actually asks
 * for, so the conversion happens here, on the way out, and the panel prints
 * the string.
 *
 * **Why a walk and not a field-by-field view.** `getForAdmin` includes the
 * service, the address, the add-ons, the payments and the status history as
 * whole rows, each with its own `createdAt` / `updatedAt`; naming all of them
 * would be eighty lines that silently miss the next column somebody adds. The
 * walk is driven by the **key name**, not by guessing from the value:
 *
 *   * a key ending in `Date` (`sessionDate`, `fromDate`, `toDate`) is a
 *     `@db.Date` calendar day → `dd-mm-yyyy`
 *   * anything else is a `timestamptz` → `dd-mm-yyyy HH:mm:ss`
 *
 * **Boundary only.** `cancelForAdmin` calls `getForAdmin` for its own logic
 * and needs real `Date` objects, so this is applied in the controller, never
 * inside the service.
 */
import { formatDate, formatDateTime } from '../../common/dates/format';

/** A calendar day is named `…Date`; everything else carries a clock. */
const isCalendarDayKey = (key: string): boolean => key.endsWith('Date');

/**
 * Every `Date` in the tree, formatted for a person to read. Arrays and plain
 * objects are rebuilt; `Decimal`, `Buffer` and the like are returned as they
 * are, because only `Date` is rewritten.
 */
export function formatBookingDates<T>(value: T, key = ''): T {
  if (value instanceof Date) {
    return (isCalendarDayKey(key) ? formatDate(value) : formatDateTime(value)) as T;
  }

  if (Array.isArray(value)) {
    // The element inherits its array's key: `sessions[].sessionDate` is
    // reached by its own key, but `dates: [Date, Date]` would not be.
    return value.map((entry) => formatBookingDates(entry, key)) as T;
  }

  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    const out: Record<string, unknown> = {};

    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = formatBookingDates(childValue, childKey);
    }

    return out as T;
  }

  return value;
}

/**
 * Prisma hands back plain objects for rows and `Decimal` instances for money.
 * Rebuilding a `Decimal` would lose it, so only objects whose prototype is
 * `Object.prototype` (or null) are walked into.
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}
