/**
 * A date in the reader's own locale, or `null` when `iso` is not a date.
 * Callers pick the style and supply their own fallback text.
 */
export function formatDate(iso: string, dateStyle: 'medium' | 'long'): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle }).format(date)
}

/**
 * The reader's own zone, for a time no one tenant owns: a plan's price, the
 * billing settings, an alert list across tenants, an audit entry.
 */
export function readerZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * The date and time in one zone, month spelled out and the zone named.
 * @param date - A valid moment.
 * @param timeZone - An IANA zone name; an unknown one throws `RangeError`.
 */
function dateTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

/**
 * A date and time with its zone named, since the time depends on it:
 * "2 November 2026 at 05:30 GMT+5:30". Every staff date-time reads in this
 * one form, so one zone has one name on the page. An unknown zone reads as
 * UTC, as `formatBillingDate` does. Callers supply their own fallback text.
 * @param iso - An ISO timestamp.
 * @param timeZone - A tenant's `settings.timezone`, or `undefined` for the reader's zone.
 * @returns The date and time, or `null` when `iso` is not a date.
 */
export function formatDateTime(iso: string, timeZone?: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  try {
    return dateTimeInZone(date, timeZone ?? readerZone())
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return dateTimeInZone(date, 'UTC')
  }
}

/**
 * A UTC day bucket as a short label: `2026-09-29` → `Sep 29`. Formatted in UTC
 * and a fixed locale, so the label names the same day the API bucketed,
 * whatever the reader's time zone.
 */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * A UTC day with its year, as a range names its ends: `2026-09-29` → `Sep 29,
 * 2026`, in `shortDate`'s fixed locale. Formatted in UTC, so it names the day
 * the API bucketed, whatever the reader's zone.
 * @param date - A `YYYY-MM-DD` day.
 */
export function utcDayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * A count as staff pages write it, grouped as express writes its limits
 * ("1,000,000") and as the app's other counts do: `1,250`. Money is not a
 * count: it reads in the Indian grouping (`formatInr`).
 * @param count - A whole number.
 */
export function formatCount(count: number): string {
  return count.toLocaleString('en-US')
}

/** The name parts a person may have on file. */
export interface NameParts {
  firstName?: string | null
  lastName?: string | null
}

/** "Ada Lovelace" from its trimmed parts, or `null` when neither has any text. */
export function fullName(person: NameParts | null | undefined): string | null {
  const parts = [person?.firstName?.trim(), person?.lastName?.trim()].filter(
    (part): part is string => Boolean(part)
  )
  return parts.length > 0 ? parts.join(' ') : null
}

/**
 * `part` as a percentage of `whole`, to two decimals: `0.03%`. A non-zero
 * part never rounds away to `0.00%`; it reads `<0.01%`. Call it only with a
 * positive `whole`: what an empty window says is the caller's to word.
 */
export function formatShare(part: number, whole: number): string {
  const share = ((part / whole) * 100).toFixed(2)
  return part > 0 && share === '0.00' ? '<0.01%' : `${share}%`
}
