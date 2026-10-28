/**
 * @file The staff credit-note form: the amount in rupees as typed, parsed into
 * the paise express takes. The tax details form is react's shared
 * `tax-details.schemas.ts`; this file is apex's own.
 */
import '@/lib/zod-jitless'
import { z } from 'zod'
import { formatInr } from '@/lib/billing-format'
import { reasonSchema } from '@/schemas/reason.schemas'

/** Rupees with up to two paise digits, 1 to 7 whole digits: no sign, exponent or comma. */
const RUPEES_PATTERN = /^(\d{1,7})(?:\.(\d{1,2}))?$/

/** The smallest credit note: ₹1, in paise. */
const MIN_CREDIT_MINOR = 100

const AMOUNT_MESSAGE = 'Enter an amount in rupees, such as 499 or 499.50.'

/**
 * The credit-note form. The amount comes from integer arithmetic on the whole
 * and paise parts, never a float, and must lie between ₹1 and what is left to
 * credit on the invoice.
 * @param remainingMinor - What the invoice can still be credited, in paise.
 */
export function creditNoteSchema(remainingMinor: number) {
  const rangeMessage = `Enter ₹1 to ${formatInr(remainingMinor)}.`
  const amountMinor = z
    .string()
    .trim()
    .transform((amountRupees, context) => {
      const match = RUPEES_PATTERN.exec(amountRupees)
      if (!match) {
        context.issues.push({ code: 'custom', message: AMOUNT_MESSAGE, input: amountRupees })
        return z.NEVER
      }
      const paise = Number((match[2] ?? '').padEnd(2, '0'))
      const minor = Number(match[1]) * 100 + paise
      if (minor < MIN_CREDIT_MINOR || minor > remainingMinor) {
        context.issues.push({ code: 'custom', message: rangeMessage, input: amountRupees })
        return z.NEVER
      }
      return minor
    })
  return z
    .object({ amountRupees: amountMinor, reason: reasonSchema })
    .transform(({ amountRupees, reason }) => ({ amountMinor: amountRupees, reason }))
}
