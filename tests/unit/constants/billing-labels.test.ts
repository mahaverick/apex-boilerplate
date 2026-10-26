import { describe, expect, it } from 'vite-plus/test'
import {
  BILLING_ALERT_KIND_LABELS,
  BILLING_SOURCE_LABELS,
  BILLING_STATE_BADGE,
  historyCauseLabel,
} from '@/constants/billing-labels'
import { BILLING_ALERT_KINDS, BILLING_HISTORY_SOURCES, BILLING_STATES } from '@/types/billing.types'

describe('BILLING_STATE_BADGE', () => {
  it('labels and tones every billing state', () => {
    expect(Object.keys(BILLING_STATE_BADGE).sort()).toEqual([...BILLING_STATES].sort())
    expect(BILLING_STATE_BADGE).toEqual({
      trialing: { label: 'Trial', tone: 'neutral' },
      free: { label: 'Free', tone: 'muted' },
      active: { label: 'Paid', tone: 'success' },
      past_due: { label: 'Payment failed', tone: 'warning' },
    })
  })
})

describe('BILLING_ALERT_KIND_LABELS', () => {
  it('labels every alert kind express raises', () => {
    expect(Object.keys(BILLING_ALERT_KIND_LABELS).sort()).toEqual([...BILLING_ALERT_KINDS].sort())
    expect(BILLING_ALERT_KIND_LABELS).toEqual({
      duplicate_refunded: 'Duplicate refunded',
      webhook_failing: 'Provider event failing',
      reconcile_repair: 'Billing job needs attention',
      dispute: 'Payment dispute',
      subscription_completed: 'Subscription ended',
    })
  })
})

describe('BILLING_SOURCE_LABELS', () => {
  it('labels every history source', () => {
    expect(Object.keys(BILLING_SOURCE_LABELS).sort()).toEqual([...BILLING_HISTORY_SOURCES].sort())
    expect(BILLING_SOURCE_LABELS.webhook).toBe('Payment provider')
    expect(BILLING_SOURCE_LABELS.reconcile).toBe('Daily check')
  })
})

describe('historyCauseLabel', () => {
  it.each([
    ['created', 'Billing record created'],
    ['trial_extended', 'Trial extended by staff'],
    ['trial_ended', 'Trial ended'],
    ['subscription_activated', 'First payment taken'],
    ['subscription_recovered', 'Payment recovered'],
    ['payment_failed', 'Payment failed'],
    ['subscription_halted', 'Payments stopped after retries'],
    ['subscription_paused', 'Subscription paused'],
    ['grace_ended', 'Grace period ended'],
    ['cancelled', 'Subscription cancelled'],
    ['subscription_completed', 'Subscription completed its last cycle'],
    ['subscription_expired', 'Subscription expired'],
    ['interval_switch', 'Billing interval switched'],
  ])('labels %s as %s', (cause, label) => {
    expect(historyCauseLabel(cause)).toBe(label)
  })

  it('words a cause it has no label for', () => {
    expect(historyCauseLabel('payer_left_workspace')).toBe('Payer left workspace')
  })
})
