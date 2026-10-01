/**
 * @file A date-range filter's value as the URL carries it: UTC calendar days,
 * `YYYY-MM-DD`, the end inclusive.
 */
import { format } from 'date-fns'
import { shortDate } from '@/lib/format'

/** Both ends as the URL carries them, UTC `YYYY-MM-DD`, `to` inclusive. */
export interface DayRange {
  from?: string
  to?: string
}

/** A picked calendar day as the date it names, whatever the reader's time zone. */
export function toDay(date: Date | undefined): string | undefined {
  return date === undefined ? undefined : format(date, 'yyyy-MM-dd')
}

/** "Sep 1 – Sep 30", "Sep 1" for one day, "From Sep 1" or "Until Sep 30" for an open end. */
export function rangeLabel({ from, to }: DayRange): string {
  if (from && to) return from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`
  if (from) return `From ${shortDate(from)}`
  if (to) return `Until ${shortDate(to)}`
  return 'Any date'
}
