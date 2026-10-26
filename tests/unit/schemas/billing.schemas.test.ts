import { describe, expect, it } from 'vite-plus/test'
import {
  billingSettingsSchema,
  extendTrialSchema,
  grantSchema,
  localDate,
  planDetailsSchema,
  priceSchema,
} from '@/schemas/billing.schemas'
import { testPlans } from '@/tests/fixtures/billing'

/** The first message the schema gives for `path`, or undefined when it gives none. */
function messageAt(
  result: { error?: { issues: { path: PropertyKey[]; message: string }[] } },
  path: string
) {
  return result.error?.issues.find((issue) => issue.path.join('.') === path)?.message
}

/** Today in the browser's zone, as a date input's value. */
const TODAY = localDate(new Date())

/** Yesterday in the browser's zone, as a date input's value. */
const YESTERDAY = localDate(
  new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 1)
)

const grant = grantSchema(testPlans.catalog)

describe('extendTrialSchema', () => {
  it('refuses 0 and 91 days', () => {
    for (const days of [0, 91, 2.5]) {
      expect(messageAt(extendTrialSchema.safeParse({ days, reason: 'Pilot' }), 'days')).toBe(
        'Enter a whole number of days from 1 to 90.'
      )
    }
  })

  it('takes 1 and 90 days with a trimmed reason', () => {
    expect(extendTrialSchema.parse({ days: 1, reason: ' Pilot ' })).toEqual({
      days: 1,
      reason: 'Pilot',
    })
    expect(extendTrialSchema.safeParse({ days: 90, reason: 'Pilot' }).success).toBe(true)
  })
})

describe('grantSchema', () => {
  it('refuses 0 as a limit grant', () => {
    const result = grant.safeParse({ key: 'members', value: 0, endsOn: '', reason: 'Team' })
    expect(messageAt(result, 'value')).toBe(
      'Enter a whole number from 1 to 1,000,000, or choose No limit.'
    )
  })

  it('refuses a limit over 1,000,000 or a part number', () => {
    for (const value of [1_000_001, 2.5, Number.NaN]) {
      const result = grant.safeParse({ key: 'members', value, endsOn: '', reason: 'Team' })
      expect(messageAt(result, 'value')).toBe(
        'Enter a whole number from 1 to 1,000,000, or choose No limit.'
      )
    }
  })

  it('takes No limit for a limit', () => {
    expect(grant.parse({ key: 'members', value: null, endsOn: '', reason: 'Team' })).toEqual({
      key: 'members',
      value: null,
      expiresAt: null,
      reason: 'Team',
    })
  })

  it('refuses a number for a feature grant', () => {
    const result = grant.safeParse({
      key: 'advanced_example',
      value: 5,
      endsOn: '',
      reason: 'Demo',
    })
    expect(messageAt(result, 'value')).toBe('A feature grant turns the feature on.')
  })

  it('refuses a key the catalog lacks', () => {
    const result = grant.safeParse({ key: 'seats', value: 5, endsOn: '', reason: 'Demo' })
    expect(messageAt(result, 'key')).toBe('Choose a limit or feature this product has.')
  })

  it('refuses an end date before today', () => {
    const result = grant.safeParse({ key: 'members', value: 10, endsOn: YESTERDAY, reason: 'Team' })
    expect(messageAt(result, 'endsOn')).toBe(
      'Choose today or a later date, or leave it empty for no end date.'
    )
  })

  it('sends expiresAt as the end of the chosen day, in the browser’s zone', () => {
    const body = grant.parse({ key: 'members', value: 10, endsOn: TODAY, reason: 'Team' })
    expect(body.expiresAt).toBe(new Date(`${TODAY}T23:59:59.999`).toISOString())
  })
})

describe('priceSchema', () => {
  it('refuses ₹0 and ₹1,00,001', () => {
    for (const amountRupees of [0, 100_001, 9.5]) {
      const result = priceSchema.safeParse({ interval: 'year', amountRupees, reason: 'New price' })
      expect(messageAt(result, 'amountRupees')).toBe(
        'Enter a whole number of rupees from ₹1 to ₹1,00,000.'
      )
    }
  })

  it('turns ₹999 into 99900 paise', () => {
    expect(
      priceSchema.parse({ interval: 'month', amountRupees: 999, reason: 'New price' })
    ).toEqual({ interval: 'month', amountMinor: 99_900, reason: 'New price' })
  })

  it('refuses an interval other than month or year', () => {
    const result = priceSchema.safeParse({ interval: 'week', amountRupees: 999, reason: 'x' })
    expect(messageAt(result, 'interval')).toBe('Choose month or year.')
  })
})

describe('billingSettingsSchema', () => {
  it('refuses a trial outside 1–90 days and a grace outside 1–30 days', () => {
    const result = billingSettingsSchema.safeParse({
      trialEnabled: true,
      trialDays: 91,
      pastDueGraceDays: 0,
    })
    expect(messageAt(result, 'trialDays')).toBe('Enter a whole number of days from 1 to 90.')
    expect(messageAt(result, 'pastDueGraceDays')).toBe('Enter a whole number of days from 1 to 30.')
  })

  it('takes the edges', () => {
    expect(
      billingSettingsSchema.safeParse({ trialEnabled: false, trialDays: 90, pastDueGraceDays: 30 })
        .success
    ).toBe(true)
  })
})

describe('planDetailsSchema', () => {
  it('trims the name and refuses an empty or long one', () => {
    expect(planDetailsSchema.parse({ name: ' Free ', description: '' })).toEqual({
      name: 'Free',
      description: '',
    })
    expect(messageAt(planDetailsSchema.safeParse({ name: '  ', description: '' }), 'name')).toBe(
      'Enter a plan name.'
    )
    expect(
      messageAt(planDetailsSchema.safeParse({ name: 'x'.repeat(65), description: '' }), 'name')
    ).toBe('Keep the plan name to 64 characters.')
  })

  it('refuses a description over 280 characters', () => {
    const result = planDetailsSchema.safeParse({ name: 'Free', description: 'x'.repeat(281) })
    expect(messageAt(result, 'description')).toBe('Keep the description to 280 characters.')
  })

  it('refuses control characters', () => {
    const result = planDetailsSchema.safeParse({ name: 'Fr\u0000ee', description: '' })
    expect(messageAt(result, 'name')).toBe('Remove the control characters from the plan name.')
  })
})
