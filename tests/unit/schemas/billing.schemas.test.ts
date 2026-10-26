import { describe, expect, it } from 'vite-plus/test'
import {
  billingSettingsSchema,
  endOfDay,
  extendTrialFormSchema,
  extendTrialSchema,
  grantFormSchema,
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

describe('extendTrialFormSchema', () => {
  it('reads the typed days as a number', () => {
    expect(extendTrialFormSchema.parse({ days: ' 14 ', reason: 'Pilot' })).toEqual({
      days: 14,
      reason: 'Pilot',
    })
  })

  it('refuses empty, signed, part and non-digit days with express’s message', () => {
    for (const days of ['', '-3', '2.5', '1e1', '0x10', 'seven', '91']) {
      expect(messageAt(extendTrialFormSchema.safeParse({ days, reason: 'Pilot' }), 'days')).toBe(
        'Enter a whole number of days from 1 to 90.'
      )
    }
  })
})

describe('grantFormSchema', () => {
  const form = grantFormSchema(testPlans.catalog)
  const base = { key: 'members', value: '', noLimit: false, endsOn: '', reason: 'Team' }

  it('sends a typed limit as a number', () => {
    expect(form.parse({ ...base, value: '25' })).toEqual({
      key: 'members',
      value: 25,
      expiresAt: null,
      reason: 'Team',
    })
  })

  it('sends No limit as null, whatever was typed', () => {
    expect(form.parse({ ...base, value: '12', noLimit: true }).value).toBeNull()
  })

  it('sends true for a feature, whatever was typed', () => {
    expect(form.parse({ ...base, key: 'advanced_example', value: '5' }).value).toBe(true)
  })

  it('puts a missing or bad limit on the value field', () => {
    for (const value of ['', '0', '1.5', 'ten']) {
      expect(messageAt(form.safeParse({ ...base, value }), 'value')).toBe(
        'Enter a whole number from 1 to 1,000,000, or choose No limit.'
      )
    }
  })

  it('refuses an end date before today on the endsOn field', () => {
    expect(messageAt(form.safeParse({ ...base, value: '5', endsOn: YESTERDAY }), 'endsOn')).toBe(
      'Choose today or a later date, or leave it empty for no end date.'
    )
  })

  it('asks for a choice when no key is chosen', () => {
    expect(messageAt(form.safeParse({ ...base, key: '', value: '5' }), 'key')).toBe(
      'Choose a limit or feature this product has.'
    )
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
    expect(messageAt(result, 'value')).toBe(
      'A feature grant only turns the feature on. To set a number, choose a limit instead.'
    )
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

  it.each(['not-a-date', '2999-13-45', '2999-02-30', '29990101'])(
    'refuses %s as an end date',
    (endsOn) => {
      const result = grant.safeParse({ key: 'members', value: 10, endsOn, reason: 'Team' })
      expect(messageAt(result, 'endsOn')).toBe(
        'Choose today or a later date, or leave it empty for no end date.'
      )
    }
  )

  it.each(['2100-01-01', '9999-12-31'])('refuses %s, after the latest end date', (endsOn) => {
    const result = grant.safeParse({ key: 'members', value: 10, endsOn, reason: 'Team' })
    expect(messageAt(result, 'endsOn')).toBe(
      'Choose an end date on or before 31 Dec 2099, or leave it empty for no end date.'
    )
  })

  it('sends the latest end date as an ISO date-time express takes, in this zone', () => {
    const body = grant.parse({ key: 'members', value: 10, endsOn: '2099-12-31', reason: 'Team' })
    expect(body.expiresAt).toMatch(/^(2099-12-31|2100-01-01)T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
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
  it('asks for a choice when trials are neither on nor off', () => {
    const result = billingSettingsSchema.safeParse({
      trialEnabled: 'yes',
      trialDays: 14,
      pastDueGraceDays: 7,
    })
    expect(messageAt(result, 'trialEnabled')).toBe(
      'Choose whether new workspaces get a Paid trial.'
    )
  })

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

describe('endOfDay', () => {
  /** `getTimezoneOffset` for UTC−10:00 (Hawaii), a zone behind UTC: minutes to add to reach UTC. */
  const HAWAII = 600

  it('puts the latest grant end in the next UTC day behind UTC, still a 4-digit year', () => {
    expect(endOfDay('2099-12-31', HAWAII).toISOString()).toBe('2100-01-01T09:59:59.999Z')
  })

  it('expands 9999-12-31 behind UTC to a year express refuses, which the cap keeps clear of', () => {
    expect(endOfDay('9999-12-31', HAWAII).toISOString()).toBe('+010000-01-01T09:59:59.999Z')
  })

  it('ends the day earlier in UTC for a zone ahead of it', () => {
    expect(endOfDay('2026-11-09', -330).toISOString()).toBe('2026-11-09T18:29:59.999Z')
  })

  it('uses the browser’s zone when no offset is given', () => {
    expect(endOfDay('2026-11-09').getTime()).toBe(new Date('2026-11-09T23:59:59.999').getTime())
  })
})
