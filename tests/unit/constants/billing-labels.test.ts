import { describe, expect, it } from 'vite-plus/test'
import {
  BILLING_ALERT_KIND_LABELS,
  BILLING_EVENT_STATUS_BADGE,
  BILLING_SOURCE_LABELS,
  BILLING_STATE_BADGE,
  billingDate,
  billingDateTime,
  zoneLabel,
  historyCauseLabel,
  historySearchCode,
  INVOICE_STATUS_BADGE,
  providerLabel,
  SUBSCRIPTION_STANDING_BADGE,
  TAX_DOCUMENT_TYPE_LABELS,
  TAX_HELD_STATUS_BADGE,
} from '@/constants/billing-labels'
import { testHeldRefundAlert, testHeldSezAlert } from '@/tests/fixtures/billing'
import {
  BILLING_ALERT_KINDS,
  BILLING_EVENT_STATUSES,
  BILLING_HISTORY_SOURCES,
  BILLING_STATES,
  BILLING_SUBSCRIPTION_STANDINGS,
  INVOICE_STATUSES,
} from '@/types/billing.types'

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
      tax_held_sez: 'SEZ charge held',
      tax_issue_failed: 'Tax documents not issued',
      tax_invoice_late: 'Tax invoice issued late',
      tax_credit_note_late: 'Late credit note',
    })
  })
})

describe('tax alert fixtures', () => {
  it('carry kinds this build labels, with express’s refund text', () => {
    for (const alert of [testHeldSezAlert, testHeldRefundAlert]) {
      expect(BILLING_ALERT_KIND_LABELS[alert.kind]).toBe('SEZ charge held')
    }
    expect(testHeldRefundAlert.message).toMatch(
      /^Payment \S+ of a held SEZ invoice was refunded ₹500 \(refund \S+\)\. Issue a credit note by hand\.$/
    )
  })
})

describe('tax labels', () => {
  it('names each document type and held status', () => {
    expect(TAX_DOCUMENT_TYPE_LABELS).toEqual({ invoice: 'Tax invoice', credit_note: 'Credit note' })
    expect(TAX_HELD_STATUS_BADGE).toEqual({
      open: { label: 'Held: SEZ', tone: 'warning' },
      resolved: { label: 'Resolved', tone: 'success' },
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
    ['trial_extended', 'Trial set by staff'],
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

describe('BILLING_EVENT_STATUS_BADGE', () => {
  it('labels and tones every provider event status express reports', () => {
    expect(Object.keys(BILLING_EVENT_STATUS_BADGE).sort()).toEqual(
      [...BILLING_EVENT_STATUSES].sort()
    )
    expect(BILLING_EVENT_STATUS_BADGE).toEqual({
      processed: { label: 'Processed', tone: 'success' },
      unused: { label: 'Unused', tone: 'muted' },
      failed: { label: 'Failed', tone: 'destructive' },
      pending: { label: 'Waiting', tone: 'neutral' },
    })
  })
})

describe('SUBSCRIPTION_STANDING_BADGE', () => {
  it('labels and tones every standing', () => {
    expect(Object.keys(SUBSCRIPTION_STANDING_BADGE).sort()).toEqual(
      [...BILLING_SUBSCRIPTION_STANDINGS].sort()
    )
    expect(SUBSCRIPTION_STANDING_BADGE).toEqual({
      current: { label: 'Current', tone: 'success' },
      pending: { label: 'Pending', tone: 'neutral' },
      next: { label: 'Next', tone: 'neutral-outline' },
      earlier: { label: 'Earlier', tone: 'muted' },
    })
  })
})

describe('INVOICE_STATUS_BADGE', () => {
  it('labels and tones every invoice status', () => {
    expect(Object.keys(INVOICE_STATUS_BADGE).sort()).toEqual([...INVOICE_STATUSES].sort())
    expect(INVOICE_STATUS_BADGE).toEqual({
      issued: { label: 'Not paid', tone: 'neutral' },
      paid: { label: 'Paid', tone: 'success' },
      cancelled: { label: 'Cancelled', tone: 'muted' },
      expired: { label: 'Expired', tone: 'muted' },
    })
  })
})

describe('providerLabel', () => {
  it.each([
    ['razorpay', 'test', 'Razorpay (test)'],
    ['razorpay', 'live', 'Razorpay (live)'],
    ['fake', 'test', 'Fake (test)'],
  ] as const)('names %s in %s mode as %s', (provider, mode, label) => {
    expect(providerLabel(provider, mode)).toBe(label)
  })

  it('names a provider with no mode on file by itself', () => {
    expect(providerLabel('razorpay', null)).toBe('Razorpay')
  })
})

describe('billingDate and billingDateTime', () => {
  it('read every value that is not a date as Unknown date', () => {
    expect(billingDate('not-a-date', 'UTC')).toBe('Unknown date')
    expect(billingDateTime('not-a-date', 'UTC')).toBe('Unknown date')
    expect(billingDate('not-a-date', undefined)).toBe('Unknown date')
  })

  it('name the day in the tenant’s zone, month spelled out, as react and express do', () => {
    // Razorpay's cycles end at 18:30Z, which is midnight in India.
    expect(billingDate('2026-11-01T18:30:00.000Z', 'Asia/Kolkata')).toBe('2 November 2026')
    expect(billingDate('2026-11-01T18:30:00.000Z', 'UTC')).toBe('1 November 2026')
    expect(billingDate('2026-11-20T00:00:00.000Z', 'Pacific/Pago_Pago')).toBe('19 November 2026')
  })

  it('name the zone on a date and time, which depends on it', () => {
    expect(billingDateTime('2026-11-20T09:05:00.000Z', 'UTC')).toBe('20 November 2026 at 09:05 UTC')
    expect(billingDateTime('2026-11-20T00:00:00.000Z', 'Asia/Kolkata')).toBe(
      '20 November 2026 at 05:30 GMT+5:30'
    )
  })

  it('name a zone as the date-times do', () => {
    const at = Date.parse('2026-11-20T00:00:00.000Z')
    expect(zoneLabel('Pacific/Pago_Pago', at)).toBe('GMT-11')
    expect(zoneLabel('Asia/Kolkata', at)).toBe('GMT+5:30')
    expect(zoneLabel('UTC', at)).toBe('UTC')
    expect(zoneLabel('Mars/Olympus', at)).toBe('UTC')
  })

  it('read an unknown zone as UTC', () => {
    expect(billingDate('2026-11-01T18:30:00.000Z', 'Mars/Olympus')).toBe('1 November 2026')
    expect(billingDateTime('2026-11-20T09:05:00.000Z', 'Mars/Olympus')).toBe(
      '20 November 2026 at 09:05 UTC'
    )
  })

  it('read a date no one tenant owns in the reader’s zone', () => {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(billingDate('2026-11-01T18:30:00.000Z', undefined)).toBe(
      billingDate('2026-11-01T18:30:00.000Z', zone)
    )
    expect(billingDateTime('2026-11-01T18:30:00.000Z', undefined)).toBe(
      billingDateTime('2026-11-01T18:30:00.000Z', zone)
    )
  })
})

describe('historySearchCode', () => {
  it.each([
    ['Payment failed', 'past_due'],
    ['paid', 'active'],
    ['  TRIAL ', 'trialing'],
    ['grace period ended', 'grace_ended'],
    ['Trial set by staff', 'trial_extended'],
  ])('sends %s as %s', (term, code) => {
    expect(historySearchCode(term)).toBe(code)
  })

  it('sends a part of a label, or a code, as typed', () => {
    expect(historySearchCode('pay')).toBe('pay')
    expect(historySearchCode('past_due')).toBe('past_due')
  })
})
