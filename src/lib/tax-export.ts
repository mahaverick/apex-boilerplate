/**
 * @file The GST return export's periods, as the audit log and the export
 * card name them. A period is `YYYY-MM`, a calendar month, or `YYYY-Qn`, a
 * quarter of the financial year that starts in April of `YYYY`.
 */
import { IST } from '@/lib/tax-format'

/** Month names in English, whatever the reader's locale. */
const MONTH_FORMAT = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' })

/**
 * A period in words: `2026-09` reads `September 2026` and `2026-Q4` reads
 * `Q4 2026-27`.
 * @param period - A `YYYY-MM` or `YYYY-Qn` period.
 * @returns The words, or `null` for anything else.
 */
export function periodLabel(period: string): string | null {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  if (month?.[1] !== undefined && month[2] !== undefined) {
    return `${MONTH_FORMAT.format(Date.UTC(Number(month[1]), Number(month[2]) - 1))} ${month[1]}`
  }
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period)
  if (quarter?.[1] !== undefined && quarter[2] !== undefined) {
    const next = String((Number(quarter[1]) + 1) % 100).padStart(2, '0')
    return `Q${quarter[2]} ${quarter[1]}-${next}`
  }
  return null
}

/** A period the card offers: the value express takes and the words the select shows. */
export interface ExportPeriod {
  value: string
  label: string
}

/** The IST calendar date's parts, whatever zone the machine keeps. */
const IST_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: IST,
  year: 'numeric',
  month: 'numeric',
})

/**
 * The IST year and month of an instant.
 * @param now - The instant.
 * @returns The year, and the month from 1 to 12.
 */
function istYearMonth(now: Date): { year: number; month: number } {
  const parts = IST_PARTS.formatToParts(now)
  /** The number of one date part. */
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: read('year'), month: read('month') }
}

/** Months since year 0, so a month is one integer. */
const monthIndex = (year: number, month: number) => year * 12 + (month - 1)

/** Quarters since year 0 of the financial year, which starts in April: April to June is Q1. */
function quarterIndex(year: number, month: number): number {
  const financialYear = month >= 4 ? year : year - 1
  return financialYear * 4 + Math.floor(((month + 8) % 12) / 3)
}

/** The first three letters of a calendar month, as the quarter labels print them. */
const SHORT_MONTH = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' })

/** The value and words of the quarter at `index`. */
function quarterPeriod(index: number): ExportPeriod {
  const year = Math.floor(index / 4)
  const quarter = (index % 4) + 1
  // Q1 starts in April, so the first calendar month of quarter n is April plus three months each.
  const startMonth = 3 + (quarter - 1) * 3
  const endMonth = startMonth + 2
  /** The calendar year of a month counted from January of the financial year. */
  const calendarYear = (month: number) => year + Math.floor(month / 12)
  /** A month's short name. */
  const short = (month: number) => SHORT_MONTH.format(Date.UTC(2000, month % 12))
  const range = `${short(startMonth)}–${short(endMonth)} ${calendarYear(endMonth)}`
  return {
    value: `${year}-Q${quarter}`,
    label: `Q${quarter} ${year}-${String((year + 1) % 100).padStart(2, '0')} (${range})`,
  }
}

/** The value and words of the month at `index`. */
function monthPeriod(index: number): ExportPeriod {
  const year = Math.floor(index / 12)
  const value = `${year}-${String((index % 12) + 1).padStart(2, '0')}`
  return { value, label: periodLabel(value) ?? value }
}

/**
 * The months or quarters the export card offers, newest first, all dated in
 * India Standard Time (IST). They run back to the one that holds
 * `effectiveFrom`, or 24 months or 8 quarters when it is `null`. A start
 * date in the future leaves the current period.
 * @param now - The current instant.
 * @param kind - A calendar month, or a quarter of the financial year.
 * @param effectiveFrom - The GST start date as `YYYY-MM-DD` in IST, or `null`.
 */
export function exportPeriods(
  now: Date,
  kind: 'month' | 'quarter',
  effectiveFrom: string | null
): ExportPeriod[] {
  const { year, month } = istYearMonth(now)
  const index = kind === 'month' ? monthIndex(year, month) : quarterIndex(year, month)
  const from = /^(\d{4})-(\d{2})/.exec(effectiveFrom ?? '')
  let count = kind === 'month' ? 24 : 8
  if (from?.[1] !== undefined && from[2] !== undefined) {
    const start = Number(from[1])
    const startMonth = Number(from[2])
    const first = kind === 'month' ? monthIndex(start, startMonth) : quarterIndex(start, startMonth)
    count = Math.max(1, index - first + 1)
  }
  return Array.from({ length: count }, (_, back) =>
    kind === 'month' ? monthPeriod(index - back) : quarterPeriod(index - back)
  )
}

/**
 * The period the card starts on: the one before the current, since a return
 * covers a finished period. When the start date is later, the oldest offered.
 * @param now - The current instant.
 * @param kind - A calendar month, or a quarter of the financial year.
 * @param effectiveFrom - The GST start date as `YYYY-MM-DD` in IST, or `null`.
 * @returns The period's value.
 */
export function defaultPeriod(
  now: Date,
  kind: 'month' | 'quarter',
  effectiveFrom: string | null
): string {
  const periods = exportPeriods(now, kind, effectiveFrom)
  return (periods[1] ?? periods[0])?.value ?? ''
}
