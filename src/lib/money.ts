/**
 * @file Money as staff read it: whole rupees in the Indian grouping
 * (`₹1,00,000`). The API sends integer paise; react's `formatInr` uses the
 * same format, so both apps show one price the same way.
 */

/** The one INR format: no paise, Indian digit grouping. */
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

/**
 * An amount in paise as whole rupees: 99900 → `₹999`.
 * @param amountMinor - The amount in paise, as the API sends it.
 */
export function formatInr(amountMinor: number): string {
  return INR.format(amountMinor / 100)
}
