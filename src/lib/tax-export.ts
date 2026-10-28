/**
 * @file The GST return export's periods, as the audit log and the export
 * card name them. A period is `YYYY-MM`, a calendar month, or `YYYY-Qn`, a
 * quarter of the financial year that starts in April of `YYYY`.
 */

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
