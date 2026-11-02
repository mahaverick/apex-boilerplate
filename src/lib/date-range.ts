/**
 * @file A date-range filter's value as the URL carries it: UTC calendar days,
 * `YYYY-MM-DD`, the end inclusive.
 */
import { format } from 'date-fns'
import { utcDayLabel } from '@/lib/format'

/** Both ends as the URL carries them, UTC `YYYY-MM-DD`, `to` inclusive. */
export interface DayRange {
  from?: string
  to?: string
}

/** A picked calendar day as the date it names, whatever the reader's time zone. */
export function toDay(date: Date | undefined): string | undefined {
  return date === undefined ? undefined : format(date, 'yyyy-MM-dd')
}

/**
 * "Sep 1, 2026 – Sep 30, 2026 (UTC)", "Sep 1, 2026 (UTC)" for one day, "From
 * Sep 1, 2026 (UTC)" or "Until Sep 30, 2026 (UTC)" for an open end: the days
 * are UTC days, as the API filters them.
 */
export function rangeLabel({ from, to }: DayRange): string {
  if (from && to) {
    return from === to
      ? `${utcDayLabel(from)} (UTC)`
      : `${utcDayLabel(from)} – ${utcDayLabel(to)} (UTC)`
  }
  if (from) return `From ${utcDayLabel(from)} (UTC)`
  if (to) return `Until ${utcDayLabel(to)} (UTC)`
  return 'Any date'
}
