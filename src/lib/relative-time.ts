import { formatDateTime } from '@/lib/format'

/** Largest first, so the first unit that fits is the one used. */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
]

/**
 * "3 minutes ago", "yesterday" or "in 2 hours", in the reader's own locale;
 * "under a minute ago" (or "in under a minute") within 45 seconds, and "at an
 * unknown time" for a date that does not parse. `now` is the caller's clock (`useNow`); it defaults to this
 * instant.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'at an unknown time'
  const seconds = Math.round((then - now) / 1000)
  if (Math.abs(seconds) < 45) return seconds > 0 ? 'in under a minute' : 'under a minute ago'
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return 'under a minute ago'
}

/**
 * The exact instant with its zone named, "2 November 2026 at 05:30
 * GMT+5:30" (`formatDateTime`): what a time shows, with the relative time
 * beside it in a tooltip.
 * @param iso - An ISO timestamp.
 * @param timeZone - A tenant's `settings.timezone`, or `undefined` for the reader's zone.
 * @returns The date and time, or `Unknown time` when `iso` is not one.
 */
export function absoluteTime(iso: string, timeZone?: string): string {
  return formatDateTime(iso, timeZone) ?? 'Unknown time'
}
