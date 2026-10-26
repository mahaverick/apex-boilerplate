/**
 * A date in the reader's own locale, or `null` when `iso` is not a date.
 * Callers pick the style and supply their own fallback text.
 */
export function formatDate(iso: string, dateStyle: 'medium' | 'long'): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle }).format(date)
}

/** A date and time in the reader's own locale, or `null` when `iso` is not a date. */
export function formatDateTime(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date
  )
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
