/**
 * @file The staff billing forms, mirroring express's
 * platform-billing.validators.ts: the same ranges, and its messages wherever
 * the form field is the field express validates. A form whose field differs
 * from the wire (a price in rupees, a grant's end as a date, a limit's "No
 * limit") words its own message, and parsing turns it into express's body.
 */
import '@/lib/zod-jitless'
import { z } from 'zod'
import { reasonSchema } from '@/schemas/reason.schemas'
import { safeText } from '@/schemas/safe-text.schemas'
import { BILLING_INTERVALS, type EntitlementCatalogEntry } from '@/types/billing.types'

/** The most days one trial extension or trial may run: express's `MAX_TRIAL_DAYS`. */
const MAX_TRIAL_DAYS = 90

/** The most days a failed payment keeps Paid: express's `MAX_PAST_DUE_GRACE_DAYS`. */
const MAX_PAST_DUE_GRACE_DAYS = 30

/** The largest limit a grant may set: express's `MAX_GRANT_LIMIT`. */
const MAX_GRANT_LIMIT = 1_000_000

/** The cheapest and dearest prices, in whole rupees: express's 100 to 10,000,000 paise. */
const MIN_PRICE_RUPEES = 1
const MAX_PRICE_RUPEES = 100_000

/**
 * A whole number of days from 1 to `max`, with express's message.
 * @param max - The most days the field takes.
 */
function daysSchema(max: number) {
  const message = `Enter a whole number of days from 1 to ${String(max)}.`
  return z.number({ error: message }).int(message).min(1, message).max(max, message)
}

/** The extend-trial form: express's `extendTrialBodySchema`. */
export const extendTrialSchema = z.object({
  days: daysSchema(MAX_TRIAL_DAYS),
  reason: reasonSchema,
})

/**
 * A text field's whole number: digits only, surrounding spaces ignored, or
 * NaN for anything else, so the number schema it feeds refuses it with its
 * own message. `Number` alone would take `1e1`, `0x10` and an empty string.
 * @param text - The field's value.
 */
function wholeNumber(text: string): number {
  const trimmed = text.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

/**
 * The extend-trial dialog's form: the days as typed, parsed into
 * `extendTrialSchema`'s body.
 */
export const extendTrialFormSchema = z
  .object({ days: z.string(), reason: z.string() })
  .transform(({ days, reason }) => ({ days: wholeNumber(days), reason }))
  .pipe(extendTrialSchema)

/**
 * The days a typed value adds, or null when the extend-trial form would
 * refuse it, for a preview that runs as the value changes.
 * @param text - The Days to add field's value.
 */
export function trialDaysFrom(text: string): number | null {
  const result = extendTrialSchema.shape.days.safeParse(wholeNumber(text))
  return result.success ? result.data : null
}

/**
 * A day as a date input holds it (`YYYY-MM-DD`), in the browser's zone.
 * @param date - The moment whose local calendar day to write.
 */
export function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/**
 * The latest day a grant may end: a cap well inside the 4-digit years. Only
 * a day near 9999-12-31 in a zone behind UTC comes out of `toISOString` as
 * an expanded year (`+010000-…`), which express's `z.iso.datetime()`
 * refuses; ending at 2099 keeps clear of it.
 */
export const LATEST_GRANT_END = '2099-12-31'

/** A limit grant's message: a whole number in range, or the form's No limit. */
const GRANT_LIMIT_MESSAGE = 'Enter a whole number from 1 to 1,000,000, or choose No limit.'

/**
 * The add-grant form for one catalog. `value` is the limit (null for No
 * limit) or `true` for a feature; `endsOn` is a date input's value, empty for
 * no end. It parses into express's `grantBodySchema` body: `expiresAt` is the
 * end of that day in the browser's zone, as an ISO date-time, so a grant
 * ending today is still in the future when it is sent.
 * @param catalog - The entitlements this product has, from `GET /platform/plans`.
 */
export function grantSchema(catalog: readonly EntitlementCatalogEntry[]) {
  return z
    .object({
      key: z.string(),
      value: z.unknown(),
      endsOn: z.string(),
      reason: reasonSchema,
    })
    .superRefine((form, context) => {
      const entry = catalog.find((candidate) => candidate.key === form.key)
      if (entry === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['key'],
          message: 'Choose a limit or feature this product has.',
        })
      }
      if (entry?.kind === 'feature' && form.value !== true) {
        context.addIssue({
          code: 'custom',
          path: ['value'],
          message:
            'A feature grant only turns the feature on. To set a number, choose a limit instead.',
        })
      }
      if (entry?.kind === 'limit' && !isLimitValue(form.value)) {
        context.addIssue({ code: 'custom', path: ['value'], message: GRANT_LIMIT_MESSAGE })
      }
      if (form.endsOn !== '' && !isDayFromToday(form.endsOn)) {
        context.addIssue({
          code: 'custom',
          path: ['endsOn'],
          message: 'Choose today or a later date, or leave it empty for no end date.',
        })
      } else if (form.endsOn > LATEST_GRANT_END) {
        context.addIssue({
          code: 'custom',
          path: ['endsOn'],
          message:
            'Choose an end date on or before 31 Dec 2099, or leave it empty for no end date.',
        })
      }
    })
    .transform(({ key, value, endsOn, reason }) => ({
      key,
      value: value as boolean | number | null,
      expiresAt: endsOn === '' ? null : endOfDay(endsOn).toISOString(),
      reason,
    }))
}

/**
 * The add-grant dialog's form: the limit as typed with its No limit box,
 * parsed into `grantSchema`'s input, so its errors land on `key`, `value`
 * and `endsOn`. A feature's value is always `true`; No limit is `null`.
 * @param catalog - The entitlements this product has, from `GET /platform/plans`.
 */
export function grantFormSchema(catalog: readonly EntitlementCatalogEntry[]) {
  return z
    .object({
      key: z.string(),
      value: z.string(),
      noLimit: z.boolean(),
      endsOn: z.string(),
      reason: z.string(),
    })
    .transform(({ key, value, noLimit, endsOn, reason }) => {
      const kind = catalog.find((entry) => entry.key === key)?.kind
      const grantValue: unknown = kind === 'feature' ? true : noLimit ? null : wholeNumber(value)
      return {
        key,
        value: grantValue,
        endsOn,
        reason,
      }
    })
    .pipe(grantSchema(catalog))
}

/**
 * The last moment of a `YYYY-MM-DD` day in a zone: the browser's, unless an
 * offset is given. Exported so a test can name a zone behind UTC whatever
 * zone the test process runs in.
 * @param day - A date input's value.
 * @param offsetMinutes - The zone's `getTimezoneOffset()` at that moment
 *   (600 for UTC−10:00, −330 for India); the browser's own when absent.
 */
export function endOfDay(day: string, offsetMinutes?: number): Date {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const offset =
    offsetMinutes ?? new Date(year, month - 1, date, 23, 59, 59, 999).getTimezoneOffset()
  return new Date(Date.UTC(year, month - 1, date, 23, 59, 59, 999) + offset * 60_000)
}

/**
 * Whether `day` is a real `YYYY-MM-DD` day, today or later in the browser's
 * zone. The shape is checked first: a string comparison alone would pass
 * any text that sorts after today's date.
 * @param day - A date input's value.
 */
function isDayFromToday(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const end = endOfDay(day)
  return !Number.isNaN(end.getTime()) && localDate(end) === day && day >= localDate(new Date())
}

/**
 * Whether a limit grant may take `value`: a whole number from 1 to
 * `MAX_GRANT_LIMIT`, or null for no limit, as express's `isLimitValue`.
 * @param value - The form's value.
 */
function isLimitValue(value: unknown): boolean {
  if (value === null) return true
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_GRANT_LIMIT
  )
}

/** A price outside the range: whole rupees, as the form takes them. */
const PRICE_MESSAGE = 'Enter a whole number of rupees from ₹1 to ₹1,00,000.'

/**
 * The new-price form, in whole rupees. It parses into express's
 * `createPriceBodySchema` body, with `amountMinor` in paise.
 */
export const priceSchema = z
  .object({
    interval: z.enum(BILLING_INTERVALS, { error: 'Choose month or year.' }),
    amountRupees: z
      .number({ error: PRICE_MESSAGE })
      .int(PRICE_MESSAGE)
      .min(MIN_PRICE_RUPEES, PRICE_MESSAGE)
      .max(MAX_PRICE_RUPEES, PRICE_MESSAGE),
    reason: reasonSchema,
  })
  .transform(({ interval, amountRupees, reason }) => ({
    interval,
    amountMinor: amountRupees * 100,
    reason,
  }))

/**
 * The billing settings form: express's `updateBillingSettingsBodySchema`
 * fields. The save sends only the changed ones, with the `version` it read
 * and a reason.
 */
export const billingSettingsSchema = z.object({
  trialEnabled: z.boolean({ error: 'Choose whether new workspaces get a Paid trial.' }),
  trialDays: daysSchema(MAX_TRIAL_DAYS),
  pastDueGraceDays: daysSchema(MAX_PAST_DUE_GRACE_DAYS),
})

/** The longest plan name and description: express's column widths. */
const MAX_PLAN_NAME_LENGTH = 64
const MAX_PLAN_DESCRIPTION_LENGTH = 280

/**
 * A plan's name and description, as express's `updatePlanBodySchema` takes
 * them: trimmed, the name 1–64 characters, the description at most 280 (an
 * empty one clears it), neither with control characters.
 */
export const planDetailsSchema = z.object({
  name: z
    .string({ error: 'Enter a plan name.' })
    .trim()
    .min(1, 'Enter a plan name.')
    .max(MAX_PLAN_NAME_LENGTH, `Keep the plan name to ${String(MAX_PLAN_NAME_LENGTH)} characters.`)
    .refine(safeText(), 'Remove the control characters from the plan name.'),
  description: z
    .string({ error: 'Enter the description as text.' })
    .trim()
    .max(
      MAX_PLAN_DESCRIPTION_LENGTH,
      `Keep the description to ${String(MAX_PLAN_DESCRIPTION_LENGTH)} characters.`
    )
    .refine(safeText(), 'Remove the control characters from the description.'),
})

/**
 * The staff cancel dialog's form: when the subscription ends and why, and
 * for a cancel now, the tenant's slug typed to confirm (surrounding spaces
 * ignored). It parses into express's `staffCancelBodySchema` body.
 * @param slug - The tenant's slug.
 */
export function cancelBillingFormSchema(slug: string) {
  return z
    .object({
      when: z.enum(['cycle_end', 'now'], { error: 'Choose when the subscription ends.' }),
      confirmation: z.string(),
      reason: reasonSchema,
    })
    .refine((value) => value.when !== 'now' || value.confirmation.trim() === slug, {
      path: ['confirmation'],
      message: `Type ${slug} exactly to confirm.`,
    })
    .transform(({ when, reason }) => ({ when, reason }))
}
