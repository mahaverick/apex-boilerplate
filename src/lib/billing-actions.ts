/**
 * @file What the tenant Billing tab's actions show and offer: which actions
 * a role may take in a tenant's state, how a sentence names the payment
 * provider, and the extend-trial preview, worked out as express does.
 */
import { billingDate } from '@/constants/billing-labels'
import { platformRoleAtLeast } from '@/constants/roles'
import { trialDaysFrom } from '@/schemas/billing.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'
import type {
  BillingState,
  EntitlementCatalogEntry,
  StaffCancelWhen,
  StaffTenantBilling,
} from '@/types/billing.types'

/**
 * How long a cancelled Paid stays on after its period ends, as express's
 * `CANCEL_BUFFER_DAYS` (3), before the tenant moves to Free.
 */
export const CANCEL_BUFFER_MS = 3 * 24 * 60 * 60 * 1000

/**
 * The payment provider as a sentence names it: Razorpay, or "the payment
 * provider" for the fake one a test server runs.
 * @param billing - The tenant's billing.
 */
export function providerName(billing: StaffTenantBilling): string {
  return billing.provider === 'razorpay' ? 'Razorpay' : 'the payment provider'
}

/**
 * Whether express would cancel a current subscription: an id with the tenant
 * on Paid and charged or past due, as `hasCurrentSubscription` in express's
 * checkout service reads it. A Free tenant keeps its last id after Paid ends,
 * and a pending checkout is never cancelled, so neither counts. The state is
 * the one a fresh read would serve (`effectiveState`), so a page left open
 * past a cancel's buffer or a failed payment's grace offers what a fresh
 * read would.
 * @param billing - The tenant's billing.
 * @param now - The moment the page reads as now, in milliseconds.
 */
function hasCurrentSubscription(billing: StaffTenantBilling, now: number): boolean {
  const state = effectiveState(billing, now)
  return billing.providerSubscriptionId !== null && (state === 'active' || state === 'past_due')
}

/**
 * Whether a moment has passed, as express's `now > end` reads it.
 * @param iso - The moment, as an ISO timestamp.
 * @param now - The moment the page reads as now, in milliseconds.
 * @param after - How long after `iso` it ends, in milliseconds.
 */
function hasPassed(iso: string, now: number, after = 0): boolean {
  return now > new Date(iso).getTime() + after
}

/**
 * The state express's `effectiveBillingState` would serve now. The view's
 * `state` is already that state as of the read, but a page left open moves
 * past the moment that ends it: a trial past its end, a cancelled period
 * more than `CANCEL_BUFFER_MS` past its end, and a failed payment past its
 * grace each read as Free, whatever express's billing job has stored yet.
 * An uncancelled period's end plus grace is not on the view, so it is left to
 * the next read.
 * @param billing - The tenant's billing.
 * @param now - The moment the page reads as now, in milliseconds.
 */
export function effectiveState(billing: StaffTenantBilling, now: number): BillingState {
  const { state, trialEndsAt, currentPeriodEnd, pastDue } = billing
  if (state === 'trialing')
    return trialEndsAt !== null && hasPassed(trialEndsAt, now) ? 'free' : state
  if (state === 'active') {
    return billing.cancelAtPeriodEnd &&
      currentPeriodEnd !== null &&
      hasPassed(currentPeriodEnd, now, CANCEL_BUFFER_MS)
      ? 'free'
      : state
  }
  if (state === 'past_due') {
    const graceEndsAt = pastDue?.graceEndsAt ?? null
    return graceEndsAt !== null && hasPassed(graceEndsAt, now) ? 'free' : state
  }
  return state
}

/**
 * Which billing actions a role may take on this tenant, as express allows
 * them: Resync, Extend trial and Add grant from manager, Cancel from admin.
 * Resync needs payments on (it would change nothing, yet still be audited).
 * Extend trial needs a trialing or Free tenant (express refuses a paying
 * one). An archived tenant can't use access, so it gets neither Extend trial
 * nor Add grant. Add grant needs the catalog to choose from. Cancel needs
 * payments on (express answers 502 otherwise) and something express cancels:
 * a current subscription or a next one.
 * @param role - The signed-in staff member's platform role.
 * @param tenant - The tenant's platform detail.
 * @param billing - The tenant's billing.
 * @param catalog - The entitlement catalog; empty while the plans load or if they failed.
 * @param now - The moment the page reads as now, in milliseconds.
 */
export function billingActionsFor(
  role: Parameters<typeof platformRoleAtLeast>[0],
  tenant: PlatformTenantDetail,
  billing: StaffTenantBilling,
  catalog: readonly EntitlementCatalogEntry[],
  now: number
) {
  const isManager = platformRoleAtLeast(role, 'manager')
  const archived = tenant.lifecycleState === 'archived'
  const cancellable = hasCurrentSubscription(billing, now) || billing.nextSubscriptionId !== null
  return {
    resync: isManager && billing.paymentsEnabled,
    extend: isManager && !archived && (billing.state === 'trialing' || billing.state === 'free'),
    grant: isManager && !archived && catalog.length > 0,
    cancel: platformRoleAtLeast(role, 'admin') && billing.paymentsEnabled && cancellable,
    revoke: isManager,
  }
}

/** One moment a staff cancel may end the subscription at, as the dialog offers it. */
export interface CancelChoice {
  when: StaffCancelWhen
  label: string
  /** What express does for this choice, in this tenant's case. */
  description: string
}

/**
 * The day a tenant whose paid period ended moves to Free: express keeps Paid
 * for `CANCEL_BUFFER_MS` past the end.
 * @param periodEnd - The ended period's end, as an ISO timestamp.
 * @param timeZone - The tenant's time zone.
 */
function freeFrom(periodEnd: string, timeZone: string): string {
  return billingDate(
    new Date(new Date(periodEnd).getTime() + CANCEL_BUFFER_MS).toISOString(),
    timeZone
  )
}

/**
 * The choices a staff cancel offers for this tenant, each worded as express's
 * `cancelSubscriptions` acts on it, and a line on the period already ending.
 * - Only a next subscription (no current one): cancelling ends just that.
 * - Paid taken during a trial and not charged yet: express cancels it now
 *   whatever is asked, and the tenant goes back to its trial; only Now.
 * - Past due: only Now, as the owner's cancel; a cycle-end cancel would leave
 *   a failed charge retrying.
 * - Already cancelling at its period end: express refuses a second cycle-end
 *   cancel, unless a next subscription is held, which a cycle-end cancel then
 *   ends alone.
 * - Otherwise: the end of the paid period, or now.
 * @param tenantName - The tenant's name.
 * @param billing - The tenant's billing.
 * @param now - The moment the page reads as now, in milliseconds.
 * @param timeZone - The tenant's time zone, for the dates.
 */
export function cancelChoicesFor(
  tenantName: string,
  billing: StaffTenantBilling,
  now: number,
  timeZone: string
): { choices: CancelChoice[]; note: string | null } {
  /** A date in the tenant's zone. */
  const day = (iso: string) => billingDate(iso, timeZone)
  const provider = billing.provider === 'razorpay' ? 'Razorpay' : 'The payment provider'
  const dashboard = billing.provider === 'razorpay' ? 'the Razorpay dashboard' : 'its dashboard'
  const end = billing.currentPeriodEnd
  const endsAhead = end !== null && new Date(end).getTime() > now
  const hasNext = billing.nextSubscriptionId !== null
  const nextFrom =
    billing.nextSwitch === null ? '' : `, booked from ${day(billing.nextSwitch.startsAt)}`
  const alsoNext = hasNext ? ' Its next subscription is cancelled too.' : ''
  /** Cancelling a charged subscription now. */
  const nowChoice = (refund: boolean): CancelChoice => ({
    when: 'now',
    label: 'Now',
    description: `${tenantName} moves to Free now. ${provider} charges nothing more.${refund ? ` Refund any unused period in ${dashboard}.` : ''}${alsoNext}`,
  })

  if (!hasCurrentSubscription(billing, now)) {
    return {
      choices: [
        {
          when: 'now',
          label: 'Now',
          description: `This cancels ${tenantName}’s next subscription${nextFrom}. Nothing is charged.`,
        },
      ],
      note: null,
    }
  }
  const trialEnd = billing.trialEndsAt
  if (billing.state === 'active' && trialEnd !== null && new Date(trialEnd).getTime() > now) {
    return {
      choices: [
        {
          when: 'now',
          label: 'Now',
          description: `${tenantName} hasn’t been charged yet. This cancels Paid now, and ${tenantName} goes back to its trial, which ends on ${day(trialEnd)}. Nothing is charged.${alsoNext}`,
        },
      ],
      note: null,
    }
  }
  if (billing.state === 'past_due') return { choices: [nowChoice(false)], note: null }
  if (billing.cancelAtPeriodEnd) {
    const note = end !== null && endsAhead ? `Paid already ends on ${day(end)}.` : null
    // A period that is already over leaves no unused time to refund.
    const ended = end !== null && !endsAhead
    if (!hasNext) return { choices: [nowChoice(!ended)], note }
    return {
      choices: [
        {
          when: 'cycle_end',
          label: 'Only the next subscription',
          description: ended
            ? `This cancels only ${tenantName}’s next subscription. ${tenantName}’s paid period ended on ${day(end)}, and it moves to Free on ${freeFrom(end, timeZone)}.`
            : `${tenantName} keeps Paid until ${end === null ? 'its paid period ends' : day(end)}, then moves to Free. This cancels its next subscription${nextFrom}.`,
        },
        nowChoice(!ended),
      ],
      note,
    }
  }
  return {
    choices: [
      {
        when: 'cycle_end',
        label:
          end === null
            ? 'At the end of the paid period'
            : `At the end of the paid period (${day(end)})`,
        description: `${tenantName} keeps Paid until ${end === null ? 'its paid period ends' : day(end)}, then moves to Free. Nothing more is charged.${alsoNext}`,
      },
      nowChoice(true),
    ],
    note: null,
  }
}

/**
 * The cancel's toast, from the view express answered, compared with the one
 * the dialog opened on: Free, back on the trial, Paid ending at the period's
 * end, or a next subscription gone.
 * @param tenantName - The tenant's name.
 * @param before - The billing the dialog opened on.
 * @param after - The billing the cancel answered.
 * @param timeZone - The tenant's time zone, for the dates.
 */
export function cancelToast(
  tenantName: string,
  before: StaffTenantBilling,
  after: StaffTenantBilling,
  timeZone: string
): string {
  /** A date in the tenant's zone. */
  const day = (iso: string) => billingDate(iso, timeZone)
  if (after.state === 'free' && before.state !== 'free') return `${tenantName} moved to Free.`
  if (after.state === 'trialing' && before.state !== 'trialing' && after.trialEndsAt !== null) {
    return `${tenantName} is back on its trial, which ends on ${day(after.trialEndsAt)}.`
  }
  if (!before.cancelAtPeriodEnd && after.cancelAtPeriodEnd && after.currentPeriodEnd !== null) {
    return `Paid for ${tenantName} ends on ${day(after.currentPeriodEnd)}.`
  }
  if (before.nextSubscriptionId !== null && after.nextSubscriptionId === null) {
    return `${tenantName}’s next subscription is cancelled.`
  }
  return `The subscription for ${tenantName} is cancelled.`
}

/** One day, as express's `addDays` counts it. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The preview line, worked out as express's `extendTrialEnd` does: a running
 * trial (trialing, with an end still ahead) moves `days` past its end; any
 * other tenant starts a trial now that ends `days` from now, worded for a
 * trial that lapsed before the billing job moved it, or for Free. With days
 * that aren't valid, it says only where the tenant stands.
 * @param tenantName - The tenant's name.
 * @param billing - The tenant's billing.
 * @param days - The typed days, as the form holds them.
 * @param now - The moment the page reads as now, in milliseconds.
 * @param timeZone - The tenant's time zone, for the dates.
 */
export function extendTrialPreview(
  tenantName: string,
  billing: StaffTenantBilling,
  days: string,
  now: number,
  timeZone: string
): string {
  /** A date in the tenant's zone. */
  const day = (iso: string) => billingDate(iso, timeZone)
  const count = trialDaysFrom(days)
  /** The day the trial ends when it runs `count` days from `from`. */
  const end = (from: number) => day(new Date(from + (count ?? 0) * DAY_MS).toISOString())
  const trialEnd = billing.trialEndsAt
  if (billing.state === 'trialing' && trialEnd !== null) {
    const endsAt = new Date(trialEnd).getTime()
    if (endsAt > now) {
      const current = `Trial now ends on ${day(trialEnd)}.`
      return count === null ? current : `${current} After this it ends on ${end(endsAt)}.`
    }
    const lapsed = `${tenantName}’s trial ended on ${day(trialEnd)}.`
    return count === null
      ? lapsed
      : `${lapsed} This starts a new Paid trial that ends on ${end(now)}.`
  }
  return count === null
    ? `${tenantName} is on Free.`
    : `${tenantName} is on Free. This starts a Paid trial that ends on ${end(now)}.`
}
