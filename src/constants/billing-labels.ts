/**
 * @file How staff pages name billing: each state's badge, each alert kind,
 * each state change's cause and source. The values are express's
 * (`billing.constants.ts`, `billing-state-machine.utilities.ts`); the words
 * are this app's.
 */
import type { BadgeTone } from '@/constants/badge-tones'
import type { BillingAlertKind, BillingHistorySource, BillingState } from '@/types/billing.types'

/** Each billing state's badge: Paid covers `active`; a trial and a failed payment are Paid too. */
export const BILLING_STATE_BADGE: Record<BillingState, { label: string; tone: BadgeTone }> = {
  trialing: { label: 'Trial', tone: 'neutral' },
  free: { label: 'Free', tone: 'muted' },
  active: { label: 'Paid', tone: 'success' },
  past_due: { label: 'Payment failed', tone: 'warning' },
}

/**
 * Each alert kind in a few words; the alert's message carries the detail.
 * `reconcile_repair` also files a billing job still retrying through a
 * provider outage and a lifecycle cancel that failed, so it names no repair.
 */
export const BILLING_ALERT_KIND_LABELS: Record<BillingAlertKind, string> = {
  duplicate_refunded: 'Duplicate refunded',
  webhook_failing: 'Provider event failing',
  reconcile_repair: 'Billing job needs attention',
  dispute: 'Payment dispute',
  subscription_completed: 'Subscription ended',
}

/** What moved a tenant between billing states, as the history names it. */
export const BILLING_SOURCE_LABELS: Record<BillingHistorySource, string> = {
  webhook: 'Payment provider',
  confirm: 'Checkout',
  reconcile: 'Daily check',
  job: 'Scheduled job',
  staff: 'Staff',
  owner: 'Owner',
}

/** The causes express writes on a state change, from its sync causes, scheduler, checkout and staff service. */
const HISTORY_CAUSE_LABELS: Readonly<Record<string, string>> = {
  created: 'Billing record created',
  trial_extended: 'Trial set by staff',
  trial_ended: 'Trial ended',
  subscription_activated: 'First payment taken',
  subscription_recovered: 'Payment recovered',
  payment_failed: 'Payment failed',
  subscription_halted: 'Payments stopped after retries',
  subscription_paused: 'Subscription paused',
  grace_ended: 'Grace period ended',
  cancelled: 'Subscription cancelled',
  subscription_completed: 'Subscription completed its last cycle',
  subscription_expired: 'Subscription expired',
  interval_switch: 'Billing interval switched',
}

/**
 * A state change's cause in words. `cause` is free text from a fixed
 * vocabulary, so one this build has no label for reads as its words.
 * @param cause - The history row's `cause`, such as `subscription_halted`.
 */
export function historyCauseLabel(cause: string): string {
  if (Object.hasOwn(HISTORY_CAUSE_LABELS, cause)) return HISTORY_CAUSE_LABELS[cause] ?? cause
  const words = cause.replaceAll('_', ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}
