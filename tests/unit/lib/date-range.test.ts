import { describe, expect, it } from 'vite-plus/test'
import { rangeLabel, toDay } from '@/lib/date-range'

describe('rangeLabel', () => {
  it.each([
    [{}, 'Any date'],
    [{ from: '2026-09-01', to: '2026-09-30' }, 'Sep 1, 2026 – Sep 30, 2026 (UTC)'],
    [{ from: '2026-09-01', to: '2026-09-01' }, 'Sep 1, 2026 (UTC)'],
    [{ from: '2026-09-01' }, 'From Sep 1, 2026 (UTC)'],
    [{ to: '2026-09-30' }, 'Until Sep 30, 2026 (UTC)'],
  ])('%o reads as %s', (range, label) => {
    expect(rangeLabel(range)).toBe(label)
  })
})

describe('toDay', () => {
  it('names the calendar day the reader picked, in their own time zone', () => {
    // The calendar hands over local midnight; UTC would be the previous day east of Greenwich.
    expect(toDay(new Date(2026, 8, 12))).toBe('2026-09-12')
    expect(toDay(undefined)).toBeUndefined()
  })
})
