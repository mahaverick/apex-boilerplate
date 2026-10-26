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
import {
  BILLING_INTERVALS,
  type BillingSettings,
  type EntitlementCatalogEntry,
} from '@/types/billing.types'

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
 * A moment's calendar parts in a zone; an unknown zone reads as UTC, as
 * `formatBillingDate` does.
 * @param date - A valid moment.
 * @param timeZone - An IANA zone name.
 */
function partsInZone(date: Date, timeZone: string): Record<string, number> {
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return partsInZone(date, 'UTC')
  }
  return Object.fromEntries(
    format
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  )
}

/**
 * A day as a date input holds it (`YYYY-MM-DD`), in a zone.
 * @param date - The moment whose calendar day to write.
 * @param timeZone - The tenant's time zone.
 */
export function localDate(date: Date, timeZone: string): string {
  const { year = 0, month = 1, day = 1 } = partsInZone(date, timeZone)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * How far a zone runs behind UTC at a moment, in minutes, as
 * `getTimezoneOffset` counts it: 600 for UTC−10:00, −330 for India.
 * @param at - The moment, in milliseconds.
 * @param timeZone - An IANA zone name.
 */
function zoneOffsetMinutes(at: number, timeZone: string): number {
  const {
    year = 0,
    month = 1,
    day = 1,
    hour = 0,
    minute = 0,
    second = 0,
  } = partsInZone(new Date(at), timeZone)
  const wall = Date.UTC(year, month - 1, day, hour, minute, second)
  return Math.round((Math.floor(at / 1000) * 1000 - wall) / 60_000)
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
 * end of that day in the tenant's zone, as an ISO date-time, so the Grants
 * table, which dates in that zone, shows the day chosen, and a grant ending
 * today is still in the future when it is sent.
 * @param catalog - The entitlements this product has, from `GET /platform/plans`.
 * @param timeZone - The tenant's time zone.
 */
export function grantSchema(catalog: readonly EntitlementCatalogEntry[], timeZone: string) {
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
      if (form.endsOn !== '' && !isDayFromToday(form.endsOn, timeZone)) {
        context.addIssue({
          code: 'custom',
          path: ['endsOn'],
          message: 'Choose today or a date after it, or leave it empty for no end date.',
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
      expiresAt: endsOn === '' ? null : endOfDay(endsOn, timeZone).toISOString(),
      reason,
    }))
}

/**
 * The add-grant dialog's form: the limit as typed with its No limit box,
 * parsed into `grantSchema`'s input, so its errors land on `key`, `value`
 * and `endsOn`. A feature's value is always `true`; No limit is `null`.
 * @param catalog - The entitlements this product has, from `GET /platform/plans`.
 * @param timeZone - The tenant's time zone.
 */
export function grantFormSchema(catalog: readonly EntitlementCatalogEntry[], timeZone: string) {
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
    .pipe(grantSchema(catalog, timeZone))
}

/**
 * The last moment of a `YYYY-MM-DD` day in a zone. The zone's offset is read
 * at that wall time, and read again once moved there, so a day that changes
 * offset (daylight saving) still ends at its own 23:59:59.999.
 * @param day - A date input's value.
 * @param timeZone - The tenant's time zone; an unknown one reads as UTC.
 */
export function endOfDay(day: string, timeZone: string): Date {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const wall = Date.UTC(year, month - 1, date, 23, 59, 59, 999)
  const first = wall + zoneOffsetMinutes(wall, timeZone) * 60_000
  return new Date(wall + zoneOffsetMinutes(first, timeZone) * 60_000)
}

/**
 * Whether `day` is a real `YYYY-MM-DD` day, today or later in the tenant's
 * zone. The shape is checked first: a string comparison alone would pass
 * any text that sorts after today's date.
 * @param day - A date input's value.
 * @param timeZone - The tenant's time zone.
 */
function isDayFromToday(day: string, timeZone: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const end = endOfDay(day, timeZone)
  return (
    !Number.isNaN(end.getTime()) &&
    localDate(end, timeZone) === day &&
    day >= localDate(new Date(), timeZone)
  )
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
    interval: z.enum(BILLING_INTERVALS, { error: 'Choose Monthly or Yearly.' }),
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

/** The billing settings form as the reader edits it: the switch, and each day count as typed. */
export interface BillingSettingsForm {
  trialEnabled: boolean
  trialDays: string
  pastDueGraceDays: string
}

/**
 * The billing settings form's fields, each parsing into its
 * `billingSettingsSchema` value: the days as typed become whole numbers.
 * `useChangedFields` diffs the typed values against the loaded ones and
 * parses only the fields that changed.
 */
export const billingSettingsFormSchema = z.object({
  trialEnabled: billingSettingsSchema.shape.trialEnabled,
  trialDays: z.string().transform(wholeNumber).pipe(billingSettingsSchema.shape.trialDays),
  pastDueGraceDays: z
    .string()
    .transform(wholeNumber)
    .pipe(billingSettingsSchema.shape.pastDueGraceDays),
})

/**
 * The billing settings as the form holds them, the days as text.
 * @param settings - The stored settings.
 */
export function billingSettingsForm(settings: BillingSettings): BillingSettingsForm {
  return {
    trialEnabled: settings.trialEnabled,
    trialDays: String(settings.trialDays),
    pastDueGraceDays: String(settings.pastDueGraceDays),
  }
}

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

/**
 * A plan editor's form: the name and description as typed, each limit as
 * typed with its No limit box, and each feature's switch. Field names are
 * `limits.<key>`, `noLimit.<key>` and `features.<key>`.
 */
export interface PlanEditForm {
  name: string
  description: string
  limits: Record<string, string>
  noLimit: Record<string, boolean>
  features: Record<string, boolean>
}

/**
 * A plan's stored values as the editor's form holds them.
 * @param plan - The plan's name, description and every entitlement.
 * @param catalog - The entitlements this product has.
 */
export function planEditForm(
  plan: { name: string; description: string; entitlements: Record<string, unknown> },
  catalog: readonly EntitlementCatalogEntry[]
): PlanEditForm {
  const form: PlanEditForm = {
    name: plan.name,
    description: plan.description,
    limits: {},
    noLimit: {},
    features: {},
  }
  for (const { key, kind } of catalog) {
    const value = plan.entitlements[key]
    if (kind === 'feature') {
      form.features[key] = value === true
    } else {
      form.limits[key] = typeof value === 'number' ? String(value) : ''
      form.noLimit[key] = value === null
    }
  }
  return form
}

/**
 * The entitlements a plan edit changes, against the values it opened with:
 * each limit parsed (No limit is null), each feature on or off. An unchanged
 * entry is neither checked nor sent, so a stored value today's rules refuse
 * blocks nothing. A feature is on only when its switch is, so it is always
 * on or off. A changed limit must be a whole number from 1 to 1,000,000, as
 * express's `planEntitlementsSchema` takes it, with its message; the issue
 * lands on `limits.<key>`.
 * @param catalog - The entitlements this product has.
 * @param baseline - The plan's stored values the edit diffs against.
 */
export function planEntitlementChanges(
  catalog: readonly EntitlementCatalogEntry[],
  baseline: Readonly<Record<string, unknown>>
) {
  return z.custom<PlanEditForm>().transform((form, context) => {
    const changed: Record<string, boolean | number | null> = {}
    for (const { key, kind, label } of catalog) {
      const value =
        kind === 'feature'
          ? form.features[key] === true
          : form.noLimit[key] === true
            ? null
            : wholeNumber(form.limits[key] ?? '')
      if (Object.is(value, baseline[key])) continue
      if (kind === 'limit' && !isLimitValue(value)) {
        context.addIssue({
          code: 'custom',
          path: ['limits', key],
          message: `${label}: enter a whole number from 1 to 1,000,000, or choose No limit.`,
        })
        continue
      }
      changed[key] = value
    }
    return changed
  })
}

/**
 * The plan editor's submit check: the changed name and description (from
 * `useChangedFields`) and the changed entitlements, each issue on its field.
 * @param details - `useChangedFields`'s `changes` over `planDetailsSchema`.
 * @param entitlements - `planEntitlementChanges` for the same baseline.
 */
export function planEditSchema(details: z.ZodType, entitlements: z.ZodType) {
  return z.custom<PlanEditForm>().superRefine((form, context) => {
    for (const schema of [details, entitlements]) {
      const result = schema.safeParse(form)
      if (result.success) continue
      for (const issue of result.error.issues) {
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
      }
    }
  })
}

/**
 * The new-price dialog's form: the interval and the rupees as typed, parsed
 * into `priceSchema`'s body (`amountMinor` in paise).
 */
export const priceFormSchema = z
  .object({ interval: z.string(), amountRupees: z.string(), reason: z.string() })
  .transform(({ interval, amountRupees, reason }) => ({
    interval,
    amountRupees: wholeNumber(amountRupees),
    reason,
  }))
  .pipe(priceSchema)

/**
 * The rupees a typed amount holds, or null when the new-price form would
 * refuse it, for the warning and the confirm line, which follow the typing.
 * @param text - The Amount in rupees field's value.
 */
export function priceRupeesFrom(text: string): number | null {
  const rupees = wholeNumber(text)
  return Number.isSafeInteger(rupees) && rupees >= MIN_PRICE_RUPEES && rupees <= MAX_PRICE_RUPEES
    ? rupees
    : null
}

/** The lower-limits dialog's form: the second confirm, ticked, and a reason. */
export const lowerLimitsFormSchema = z.object({
  checked: z.boolean().refine((checked) => checked, {
    message: 'Confirm you checked the tenants this affects.',
  }),
  reason: reasonSchema,
})
