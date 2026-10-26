/**
 * @file Money as staff read it, in the Indian grouping. The rule and the
 * output are react's `formatInr` (`src/lib/billing-format.ts`), so both apps
 * show one price the same way.
 */

/** Whole rupees with Indian digit grouping: `₹9,990`, `₹1,00,000`. */
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/** Rupees and paise with Indian digit grouping: `₹999.50`, `₹1.05`. */
const INR_WITH_PAISE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * An amount in rupees: whole rupees with no decimals, any other amount with
 * exactly two. express takes any whole number of paise as a price, so
 * rounding to the rupee would show a price nobody is charged.
 * @param amountMinor - The amount in paise, as the API sends it.
 * @returns For example `₹999` for 99900, or `₹999.50` for 99950.
 */
export function formatInr(amountMinor: number): string {
  const format = amountMinor % 100 === 0 ? INR : INR_WITH_PAISE
  return format.format(amountMinor / 100)
}
