/**
 * @file The staff credit-note form: the amount in rupees as typed, parsed into
 * the paise express takes. The tax details form is react's shared
 * `tax-details.schemas.ts`; this file is apex's own.
 */
import '@/lib/zod-jitless'
import { z } from 'zod'
import { formatInr } from '@/lib/billing-format'
import { reasonSchema } from '@/schemas/reason.schemas'
import {
  normaliseQuotes,
  TAX_TEXT_PATTERN,
  TEXT_PATTERN_MESSAGE,
} from '@/schemas/tax-details.schemas'

/** Rupees with up to two paise digits, 1 to 7 whole digits: no sign, exponent or comma. */
const RUPEES_PATTERN = /^(\d{1,7})(?:\.(\d{1,2}))?$/

/** The smallest credit note: ₹1, in paise. */
export const MIN_CREDIT_MINOR = 100

const AMOUNT_MESSAGE = 'Enter an amount in rupees, such as 499 or 499.50.'

/** The largest credit note express takes: ₹1,00,000, in paise. */
export const MAX_CREDIT_MINOR = 10_000_000

/**
 * The most a credit note can be: what is left on the invoice, or the largest note.
 * @param remainingMinor - What the invoice can still be credited, in paise.
 */
export const creditCapMinor = (remainingMinor: number) => Math.min(remainingMinor, MAX_CREDIT_MINOR)

/**
 * The credit note's reason, printed on the customer's document: one line of
 * printable Latin text, curly quotes sent straight, 1 to 500 characters.
 */
const creditReasonSchema = z.string().transform((raw, context) => {
  const value = normaliseQuotes(raw.trim())
  const base = reasonSchema.safeParse(value)
  /** Records a refusal and stops the parse. */
  const issue = (message: string) => {
    context.issues.push({ code: 'custom', message, input: raw })
    return z.NEVER
  }
  if (value === '' || value.length > 500) {
    return issue(base.success ? 'Enter a reason.' : base.error.issues[0]!.message)
  }
  if (/[\r\n]/.test(value)) return issue('Use one line for the reason.')
  if (!TAX_TEXT_PATTERN.test(value)) return issue(TEXT_PATTERN_MESSAGE)
  return value
})

/**
 * The credit-note form. The amount comes from integer arithmetic on the whole
 * and paise parts, never a float, and must lie between ₹1 and what is left to
 * credit on the invoice, at most ₹1,00,000.
 * @param remainingMinor - What the invoice can still be credited, in paise.
 */
export function creditNoteSchema(remainingMinor: number) {
  const capMinor = creditCapMinor(remainingMinor)
  const rangeMessage = `Enter ₹1 to ${formatInr(capMinor)}.`
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
      if (minor < MIN_CREDIT_MINOR || minor > capMinor) {
        context.issues.push({ code: 'custom', message: rangeMessage, input: amountRupees })
        return z.NEVER
      }
      return minor
    })
  return z
    .object({ amountRupees: amountMinor, reason: creditReasonSchema })
    .transform(({ amountRupees, reason }) => ({ amountMinor: amountRupees, reason }))
}
