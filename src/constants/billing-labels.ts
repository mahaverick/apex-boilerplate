/**
 * @file How staff pages name billing: each state's badge, each alert kind,
 * each state change's cause and source, each provider event's status, each
 * held subscription's standing and each invoice's status. The values are express's
 * (`billing.constants.ts`, `billing-state-machine.utilities.ts`); the words
 * are this app's.
 */
import type { BadgeTone } from '@/constants/badge-tones'
import { formatBillingDate, invoiceStatusLabel } from '@/lib/billing-format'
import type {
  BillingAlertKind,
  BillingEventStatus,
  BillingHistorySource,
  BillingProvider,
  BillingProviderMode,
  BillingState,
  BillingSubscriptionStanding,
  InvoiceStatus,
  TaxDocumentType,
  TaxHeldStatus,
} from '@/types/billing.types'

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
  tax_held_sez: 'SEZ charge held',
  tax_issue_failed: 'Tax documents not issued',
  tax_invoice_late: 'Tax invoice issued late',
  tax_credit_note_late: 'Late credit note',
}

/** What each kind of tax document is called. */
export const TAX_DOCUMENT_TYPE_LABELS: Record<TaxDocumentType, string> = {
  invoice: 'Tax invoice',
  credit_note: 'Credit note',
}

/** A held SEZ charge's badge: open waits for staff to invoice it by hand. */
export const TAX_HELD_STATUS_BADGE: Record<TaxHeldStatus, { label: string; tone: BadgeTone }> = {
  open: { label: 'Held: SEZ', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
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
  // Staff extend a running trial or start one on a Free tenant; express names both trial_extended.
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
  const known = Object.hasOwn(HISTORY_CAUSE_LABELS, cause) ? HISTORY_CAUSE_LABELS[cause] : undefined
  if (known !== undefined) return known
  const words = cause.replaceAll('_', ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** Each provider event status's badge. `pending` reads Waiting: the event is not handled yet. */
export const BILLING_EVENT_STATUS_BADGE: Record<
  BillingEventStatus,
  { label: string; tone: BadgeTone }
> = {
  processed: { label: 'Processed', tone: 'success' },
  unused: { label: 'Unused', tone: 'muted' },
  failed: { label: 'Failed', tone: 'destructive' },
  pending: { label: 'Waiting', tone: 'neutral' },
}

/** Each held subscription's standing as a badge, against the billing record now. */
export const SUBSCRIPTION_STANDING_BADGE: Record<
  BillingSubscriptionStanding,
  { label: string; tone: BadgeTone }
> = {
  current: { label: 'Current', tone: 'success' },
  pending: { label: 'Pending', tone: 'neutral' },
  next: { label: 'Next', tone: 'neutral-outline' },
  earlier: { label: 'Earlier', tone: 'muted' },
}

/**
 * Each invoice status's badge, worded as react's invoices table words it
 * (`invoiceStatusLabel`): `issued` reads "Not paid", so staff and the
 * customer use one word for one invoice.
 */
export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, { label: string; tone: BadgeTone }> = {
  issued: { label: invoiceStatusLabel('issued'), tone: 'neutral' },
  paid: { label: invoiceStatusLabel('paid'), tone: 'success' },
  cancelled: { label: invoiceStatusLabel('cancelled'), tone: 'muted' },
  expired: { label: invoiceStatusLabel('expired'), tone: 'muted' },
}

/** Each provider's name. `fake` is express's test double. */
export const PROVIDER_NAMES: Record<BillingProvider, string> = {
  razorpay: 'Razorpay',
  fake: 'Fake',
}

/**
 * The payment provider as a sentence names it: Razorpay, or "the payment
 * provider" for the fake one a test server runs, or none on file. Every
 * billing sentence names the provider through this one function.
 * @param provider - The tenant's `provider`.
 * @param options - `sentenceStart` capitalises the generic name to open a sentence.
 */
export function providerName(
  provider: BillingProvider | null,
  { sentenceStart = false }: { sentenceStart?: boolean } = {}
): string {
  if (provider === 'razorpay') return 'Razorpay'
  return sentenceStart ? 'The payment provider' : 'the payment provider'
}

/**
 * Where staff act on a subscription this server can't reach: "the Razorpay
 * dashboard", or "the payment provider’s dashboard" for another provider or
 * none on file.
 * @param provider - The tenant's `provider`, or null when unknown.
 */
export function providerDashboard(provider: BillingProvider | null): string {
  return provider === 'razorpay' ? 'the Razorpay dashboard' : 'the payment provider’s dashboard'
}

/** Each provider mode's name, as a filter option reads it. */
export const PROVIDER_MODE_NAMES: Record<BillingProviderMode, string> = {
  test: 'Test',
  live: 'Live',
}

/**
 * A payment provider and its mode: "Razorpay (test)".
 * @param provider - The provider.
 * @param mode - Its mode, or `null` when none is on file.
 */
export function providerLabel(provider: BillingProvider, mode: BillingProviderMode | null): string {
  return mode === null ? PROVIDER_NAMES[provider] : `${PROVIDER_NAMES[provider]} (${mode})`
}

/** What every billing date reads as when the value is not a date. */
const UNKNOWN_DATE = 'Unknown date'

/**
 * The reader's own zone, for a date no one tenant owns: a plan's price, the
 * billing settings, an alert list across tenants.
 */
function readerZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * A billing date as react's billing page and express's billing emails write
 * it (`formatBillingDate`): "2 November 2026", in the tenant's zone, so staff
 * and the customer name the same day. A date no one tenant owns reads in
 * the reader's zone.
 * @param iso - An ISO timestamp.
 * @param timeZone - The tenant's `settings.timezone`, or `undefined` for the reader's zone.
 * @returns The date, or `Unknown date` when `iso` is not one.
 */
export function billingDate(iso: string, timeZone: string | undefined): string {
  return formatBillingDate(iso, timeZone ?? readerZone()) || UNKNOWN_DATE
}

/**
 * A billing date and time with its zone named, since the time depends on it:
 * "2 November 2026 at 05:30 GMT+5:30". An unknown zone reads as UTC, as
 * `formatBillingDate` does.
 * @param iso - An ISO timestamp.
 * @param timeZone - The tenant's `settings.timezone`, or `undefined` for the reader's zone.
 * @returns The date and time, or `Unknown date` when `iso` is not one.
 */
export function billingDateTime(iso: string, timeZone: string | undefined): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return UNKNOWN_DATE
  try {
    return dateTimeInZone(date, timeZone ?? readerZone())
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return dateTimeInZone(date, 'UTC')
  }
}

/**
 * A zone as a billing date-time names it ("GMT-11", "GMT+5:30", "UTC"), so
 * one zone has one form on the page. An unknown zone reads as UTC.
 * @param timeZone - An IANA zone name.
 * @param at - The moment whose offset to name, in milliseconds.
 */
export function zoneLabel(timeZone: string, at: number): string {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(at)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return 'UTC'
  }
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone
}

/**
 * The date and time in one zone, month spelled out and the zone named.
 * @param date - A valid moment.
 * @param timeZone - An IANA zone name; an unknown one throws `RangeError`.
 */
function dateTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

/**
 * The stored code a history search should send. Express matches the stored
 * state and cause codes, while the table shows their labels, so a term that
 * is a whole state or cause label (any case) becomes its code; any other term
 * is sent as typed.
 * @param term - What the reader typed.
 * @returns The code, such as `past_due` for "Payment failed", or the term.
 */
export function historySearchCode(term: string): string {
  const wanted = term.trim().toLowerCase()
  const labelled: [string, string][] = [
    ...Object.entries(BILLING_STATE_BADGE).map(([code, { label }]): [string, string] => [
      code,
      label,
    ]),
    ...Object.entries(HISTORY_CAUSE_LABELS),
  ]
  return labelled.find(([, label]) => label.toLowerCase() === wanted)?.[0] ?? term
}
