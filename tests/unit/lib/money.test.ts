import { describe, expect, it } from 'vite-plus/test'
import { formatInr } from '@/lib/money'

describe('formatInr', () => {
  it.each([
    [99_900, '₹999'],
    [1_500_000, '₹15,000'],
    [10_000_000, '₹1,00,000'],
    [100, '₹1'],
  ])('writes %i paise as %s', (amountMinor, expected) => {
    expect(formatInr(amountMinor)).toBe(expected)
  })

  it('rounds a part-rupee amount to whole rupees', () => {
    expect(formatInr(99_950)).toBe('₹1,000')
  })
})
