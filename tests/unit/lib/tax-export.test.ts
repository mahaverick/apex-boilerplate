import { describe, expect, it } from 'vite-plus/test'
import { periodLabel } from '@/lib/tax-export'

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
