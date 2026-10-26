/**
 * @file What the tenant Billing tab's actions show and offer: which actions
 * a role may take in a tenant's state, how a sentence names the payment
 * provider, and the extend-trial preview, worked out as express does.
 */
import { billingDate } from '@/constants/billing-labels'
import { platformRoleAtLeast } from '@/constants/roles'
import { trialDaysFrom } from '@/schemas/billing.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'
import type { EntitlementCatalogEntry, StaffTenantBilling } from '@/types/billing.types'

/**
 * The payment provider as a sentence names it: Razorpay, or "the payment
 * provider" for the fake one a test server runs.
 * @param billing - The tenant's billing.
 */
export function providerName(billing: StaffTenantBilling): string {
  return billing.provider === 'razorpay' ? 'Razorpay' : 'the payment provider'
}

/**
 * Which billing actions a role may take on this tenant, as express allows
 * them: Resync, Extend trial and Add grant from manager, Cancel from admin.
 * Resync needs payments on (it would change nothing, yet still be audited).
 * Extend trial needs a trialing or Free tenant (express refuses a paying
 * one). An archived tenant can't use access, so it gets neither Extend trial
 * nor Add grant. Add grant needs the catalog to choose from. Cancel needs a
 * subscription id to cancel.
 * @param role - The signed-in staff member's platform role.
 * @param tenant - The tenant's platform detail.
 * @param billing - The tenant's billing.
 * @param catalog - The entitlement catalog; empty while the plans load or if they failed.
 */
export function billingActionsFor(
  role: Parameters<typeof platformRoleAtLeast>[0],
  tenant: PlatformTenantDetail,
  billing: StaffTenantBilling,
  catalog: readonly EntitlementCatalogEntry[]
) {
  const isManager = platformRoleAtLeast(role, 'manager')
  const archived = tenant.lifecycleState === 'archived'
  const holdsSubscription = [
    billing.providerSubscriptionId,
    billing.pendingSubscriptionId,
    billing.nextSubscriptionId,
  ].some((id) => id !== null)
  return {
    resync: isManager && billing.paymentsEnabled,
    extend: isManager && !archived && (billing.state === 'trialing' || billing.state === 'free'),
    grant: isManager && !archived && catalog.length > 0,
    cancel: platformRoleAtLeast(role, 'admin') && holdsSubscription,
    revoke: isManager,
  }
}

/** One day, as express's `addDays` counts it. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The preview line, worked out as express's `extendTrialEnd` does: a running
 * trial (trialing, with an end still ahead) moves `days` past its end; any
 * other tenant, Free or with a lapsed trial, starts a trial now that ends
 * `days` from now. With days that aren't valid, it says only where the
 * tenant stands.
 * @param tenantName - The tenant's name.
 * @param billing - The tenant's billing.
 * @param days - The typed days, as the form holds them.
 * @param now - The moment the page reads as now, in milliseconds.
 */
export function extendTrialPreview(
  tenantName: string,
  billing: StaffTenantBilling,
  days: string,
  now: number
): string {
  const count = trialDaysFrom(days)
  const runningEnd =
    billing.state === 'trialing' && billing.trialEndsAt !== null
      ? new Date(billing.trialEndsAt).getTime()
      : null
  const isRunning = runningEnd !== null && runningEnd > now
  /** The day the trial ends when it runs `count` days from `from`. */
  const end = (from: number) => billingDate(new Date(from + (count ?? 0) * DAY_MS).toISOString())
  if (isRunning && billing.trialEndsAt !== null) {
    const current = `Trial ends on ${billingDate(billing.trialEndsAt)} now.`
    return count !== null ? `${current} After this it ends on ${end(runningEnd)}.` : current
  }
  return count !== null
    ? `${tenantName} is on Free. This starts a Paid trial that ends on ${end(now)}.`
    : `${tenantName} is on Free.`
}
