import { describe, expect, it } from 'vite-plus/test'
import { CANCEL_BUFFER_MS, cancelChoicesFor, effectiveState } from '@/lib/billing-actions'
import { testFreeTenantBilling, testTenantBilling } from '@/tests/fixtures/billing'
import type { StaffTenantBilling } from '@/types/billing.types'

const NOW = Date.parse('2026-11-20T12:00:00.000Z')

/** One millisecond, the boundary express's `now > end` turns on. */
const MS = 1

/**
 * `iso` moved by `ms` from `NOW`.
 * @param ms - Milliseconds from `NOW`; negative is earlier.
 */
function at(ms: number): string {
  return new Date(NOW + ms).toISOString()
}

describe('effectiveState', () => {
  it('reads a trial past its end as Free, as express serves it, and one at its end as a trial', () => {
    const trial: StaffTenantBilling = { ...testTenantBilling, state: 'trialing' }
    expect(effectiveState({ ...trial, trialEndsAt: at(-MS) }, NOW)).toBe('free')
    expect(effectiveState({ ...trial, trialEndsAt: at(0) }, NOW)).toBe('trialing')
    expect(effectiveState({ ...trial, trialEndsAt: null }, NOW)).toBe('trialing')
  })

  it('reads a cancelled period past its 3-day buffer as Free, and one at the buffer’s end as Paid', () => {
    const cancelling: StaffTenantBilling = { ...testTenantBilling, cancelAtPeriodEnd: true }
    expect(
      effectiveState({ ...cancelling, currentPeriodEnd: at(-CANCEL_BUFFER_MS - MS) }, NOW)
    ).toBe('free')
    expect(effectiveState({ ...cancelling, currentPeriodEnd: at(-CANCEL_BUFFER_MS) }, NOW)).toBe(
      'active'
    )
    expect(
      effectiveState({ ...testTenantBilling, currentPeriodEnd: at(-CANCEL_BUFFER_MS - MS) }, NOW)
    ).toBe('active')
  })

  it('reads a failed payment past its grace as Free, and one still retrying as past due', () => {
    const pastDue: StaffTenantBilling = { ...testTenantBilling, state: 'past_due' }
    const failed = { since: at(-10 * CANCEL_BUFFER_MS), paused: false }
    expect(effectiveState({ ...pastDue, pastDue: { ...failed, graceEndsAt: at(-MS) } }, NOW)).toBe(
      'free'
    )
    expect(effectiveState({ ...pastDue, pastDue: { ...failed, graceEndsAt: at(0) } }, NOW)).toBe(
      'past_due'
    )
    expect(effectiveState({ ...pastDue, pastDue: { ...failed, graceEndsAt: null } }, NOW)).toBe(
      'past_due'
    )
  })

  it('keeps Free as Free', () => {
    expect(effectiveState(testFreeTenantBilling, NOW)).toBe('free')
  })
})

describe('cancelChoicesFor, with no period end on file', () => {
  // Express allows an active row with no currentPeriodEnd; the dialog then names no date.
  const active: StaffTenantBilling = { ...testTenantBilling, currentPeriodEnd: null }

  it('offers the end of the paid period with no date, and says Paid lasts until it ends', () => {
    const { choices } = cancelChoicesFor('Acme Corp', active, NOW, 'UTC')
    expect(choices[0]).toEqual({
      when: 'cycle_end',
      label: 'At the end of the paid period',
      description:
        'Acme Corp keeps Paid until its paid period ends, then moves to Free. Nothing more is charged.',
    })
  })

  it('words a next subscription’s cancel while cancelling with no date', () => {
    const { choices } = cancelChoicesFor(
      'Acme Corp',
      { ...active, cancelAtPeriodEnd: true, nextSubscriptionId: 'sub_TestNext0001' },
      NOW,
      'UTC'
    )
    expect(choices[0]?.description).toBe(
      'Acme Corp keeps Paid until its paid period ends, then moves to Free. This cancels its next subscription.'
    )
  })
})
