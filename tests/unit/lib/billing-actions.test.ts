import { describe, expect, it } from 'vite-plus/test'
import { CANCEL_BUFFER_MS, effectiveState } from '@/lib/billing-actions'
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
