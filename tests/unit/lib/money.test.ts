import { describe, expect, it } from 'vite-plus/test'
import { formatInr } from '@/lib/money'

describe('formatInr', () => {
  it.each([
    [99_900, '₹999'],
    [100_000, '₹1,000'],
    [1_500_000, '₹15,000'],
    [10_000_000, '₹1,00,000'],
    [100, '₹1'],
  ])('writes %i paise as whole rupees, %s', (amountMinor, expected) => {
    expect(formatInr(amountMinor)).toBe(expected)
  })

  it.each([
    [99_950, '₹999.50'],
    [105, '₹1.05'],
    [1_234_501, '₹12,345.01'],
  ])('writes %i paise with exactly two decimals, %s', (amountMinor, expected) => {
    expect(formatInr(amountMinor)).toBe(expected)
  })
})
