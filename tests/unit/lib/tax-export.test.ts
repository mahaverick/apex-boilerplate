import { describe, expect, it } from 'vite-plus/test'
import { defaultPeriod, exportPeriods, periodLabel } from '@/lib/tax-export'

describe('periodLabel', () => {
  it.each([
    ['2026-09', 'September 2026'],
    ['2026-01', 'January 2026'],
    ['2026-12', 'December 2026'],
    ['2026-Q1', 'Q1 2026-27'],
    ['2026-Q4', 'Q4 2026-27'],
    ['2099-Q2', 'Q2 2099-00'],
  ])('words %s as %s', (period, label) => {
    expect(periodLabel(period)).toBe(label)
  })

  it.each(['', '2026-00', '2026-13', '2026-Q0', '2026-Q5', '2026-q1', '26-09', '2026-9', 'x'])(
    'reads %j as no period',
    (period) => {
      expect(periodLabel(period)).toBeNull()
    }
  )
})

/** The values of the periods offered. */
const values = (periods: Array<{ value: string }>) => periods.map((period) => period.value)

describe('exportPeriods and defaultPeriod', () => {
  const NOON = new Date('2026-10-27T10:00:00+05:30')

  it('offers 24 months, newest first, and defaults to last month', () => {
    const months = exportPeriods(NOON, 'month', null)
    expect(months).toHaveLength(24)
    expect(months[0]).toEqual({ value: '2026-10', label: 'October 2026' })
    expect(months[1]?.value).toBe('2026-09')
    expect(months[23]?.value).toBe('2024-11')
    expect(defaultPeriod(NOON, 'month', null)).toBe('2026-09')
  })

  it('offers 8 quarters, newest first, and defaults to last quarter', () => {
    const quarters = exportPeriods(NOON, 'quarter', null)
    expect(quarters).toHaveLength(8)
    expect(quarters[0]).toEqual({ value: '2026-Q3', label: 'Q3 2026-27 (Oct–Dec 2026)' })
    expect(quarters[1]).toEqual({ value: '2026-Q2', label: 'Q2 2026-27 (Jul–Sep 2026)' })
    expect(quarters[7]?.value).toBe('2024-Q4')
    expect(defaultPeriod(NOON, 'quarter', null)).toBe('2026-Q2')
  })

  it('stops at the month or quarter that holds the GST start date', () => {
    expect(values(exportPeriods(NOON, 'month', '2026-08-15'))).toEqual([
      '2026-10',
      '2026-09',
      '2026-08',
    ])
    expect(values(exportPeriods(NOON, 'quarter', '2026-08-15'))).toEqual(['2026-Q3', '2026-Q2'])
  })

  it('offers the current month only when the start date is this month', () => {
    expect(values(exportPeriods(NOON, 'month', '2026-10-01'))).toEqual(['2026-10'])
    expect(defaultPeriod(NOON, 'month', '2026-10-01')).toBe('2026-10')
  })

  it('offers the current period only when the start date is in the future', () => {
    expect(values(exportPeriods(NOON, 'month', '2027-03-01'))).toEqual(['2026-10'])
    expect(values(exportPeriods(NOON, 'quarter', '2027-03-01'))).toEqual(['2026-Q3'])
  })

  it('reads the IST date, not the UTC date', () => {
    const lateInUtc = new Date('2027-01-05T00:30:00+05:30')
    expect(lateInUtc.toISOString()).toBe('2027-01-04T19:00:00.000Z')
    expect(exportPeriods(lateInUtc, 'quarter', null)[0]?.value).toBe('2026-Q4')
    expect(exportPeriods(lateInUtc, 'quarter', null)[0]?.label).toBe('Q4 2026-27 (Jan–Mar 2027)')
    expect(defaultPeriod(lateInUtc, 'month', null)).toBe('2026-12')
  })

  it('starts the financial year in April, IST', () => {
    const aprilFirst = new Date('2026-04-01T00:10:00+05:30')
    expect(exportPeriods(aprilFirst, 'quarter', null)[0]?.value).toBe('2026-Q1')
    expect(exportPeriods(aprilFirst, 'month', null)[0]?.value).toBe('2026-04')
    const beforeApril = new Date('2026-03-31T23:50:00+05:30')
    expect(exportPeriods(beforeApril, 'quarter', null)[0]?.value).toBe('2025-Q4')
  })
})
