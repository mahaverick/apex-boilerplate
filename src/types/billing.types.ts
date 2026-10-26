/**
 * @file The staff half of the billing API contract
 * (docs/2026-10-24-billing-api-contract.md §1 and §5), as the server sends
 * it. Apex's own subset of react's `billing.types.ts`, whose text it copies:
 * apex reads no customer billing route, so the checkout, invoice, plan-page
 * and upgrade-request types stay react's. Money is integer minor units
 * (paise) plus `currency`; timestamps are ISO 8601 UTC strings.
 */

/** The plans the API serves. */
export type PlanKey = 'free' | 'paid'

/** Where a workspace is in its billing lifecycle, in express's order (`BILLING_STATES`). */
export const BILLING_STATES = ['trialing', 'free', 'active', 'past_due'] as const

/** Where a workspace is in its billing lifecycle. `trialing` and `active` and `past_due` are all on Paid. */
export type BillingState = (typeof BILLING_STATES)[number]

/** How often a Paid subscription charges, as express's `BILLING_INTERVALS`. */
export const BILLING_INTERVALS = ['month', 'year'] as const

/** How often a Paid subscription charges. */
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

/** What moved a workspace from one billing state to another, as express's `BILLING_HISTORY_SOURCES`. */
export const BILLING_HISTORY_SOURCES = [
  'webhook',
  'confirm',
  'reconcile',
  'job',
  'staff',
  'owner',
] as const

/** One source of a billing state change. */
export type BillingHistorySource = (typeof BILLING_HISTORY_SOURCES)[number]

/** The kinds of billing alert staff see, as express's `BILLING_ALERT_KINDS`. */
export const BILLING_ALERT_KINDS = [
  'duplicate_refunded',
  'webhook_failing',
  'reconcile_repair',
  'dispute',
  'subscription_completed',
] as const

/** One kind of billing alert. */
export type BillingAlertKind = (typeof BILLING_ALERT_KINDS)[number]

/** When a staff cancel ends the subscription, as express's `STAFF_CANCEL_WHEN`. */
export type StaffCancelWhen = 'cycle_end' | 'now'

/** A catalog entry is an on/off feature or a numeric limit. */
type EntitlementKind = 'feature' | 'limit'

/** One entitlement the catalog names, with the wording the app shows for it. */
export interface EntitlementCatalogEntry {
  key: string
  kind: EntitlementKind
  label: string
  description: string
}

/** A plan's value for one entitlement: a feature is a boolean, a limit is a number, and `null` is unlimited. */
export type EntitlementValue = boolean | number | null

/** One price of a plan. */
interface PriceView {
  id: string
  interval: BillingInterval
  amountMinor: number
  currency: 'INR'
}

/** One limit's use. `approaching` is `used >= ceil(limit * softAt)` and `used < limit`. */
interface LimitUsage {
  limit: number | null
  used: number
  approaching: boolean
}

/** A failed card payment. `graceEndsAt` is `null` while Razorpay is still retrying. */
interface PastDue {
  since: string
  graceEndsAt: string | null
  paused: boolean
}

/** What the workspace may use now, as `GET /tenants/:slug/entitlements` answers it. */
interface TenantEntitlements {
  /** The effective plan: Paid while trialing, active or past due. */
  plan: { key: PlanKey; name: string }
  /** The effective state: a lapsed trial reads `free` before the job runs. */
  state: BillingState
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDue: PastDue | null
  features: Record<string, boolean>
  limits: Record<string, LimitUsage>
}

/** The customer billing view the staff view extends. Owner-only fields are `null` for staff. */
interface TenantBilling {
  state: BillingState
  plan: { key: PlanKey; name: string }
  interval: BillingInterval | null
  /** The price this tenant pays, which may be a retired one. */
  price: PriceView | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pastDue: PastDue | null
  /** Set once the next subscription is authenticated: a switch, or a resubscribe while cancelling. */
  nextSwitch: { interval: BillingInterval; startsAt: string } | null
  /** Who pays. `isMember: false` means the payer left the workspace. */
  payer: { userId: string; name: string; isMember: boolean } | null
  /** Owner only, so always `null` for staff. */
  billingEmail: string | null
  paymentsEnabled: boolean
  dismissedBanners: string[]
}

/** An entitlement override staff granted a workspace. A feature grant's value is always `true`. */
interface Grant {
  id: string
  key: string
  value: EntitlementValue
  reason: string
  /** `null` when the account was purged or a script wrote the grant. */
  grantedBy: { userId: string; name: string } | null
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  status: 'active' | 'expired' | 'revoked'
}

/** `GET /platform/tenants/:id/billing`: the customer view plus provider ids, grants and history. */
export interface StaffTenantBilling extends TenantBilling {
  provider: 'razorpay' | 'fake' | null
  providerMode: 'test' | 'live' | null
  providerSubscriptionId: string | null
  pendingSubscriptionId: string | null
  nextSubscriptionId: string | null
  syncedAt: string | null
  disputeOpen: boolean
  entitlements: TenantEntitlements
  sources: Record<string, 'plan' | 'grant'>
  grants: Grant[]
  /** The newest 20. */
  history: Array<{
    from: BillingState | null
    to: BillingState
    cause: string
    source: BillingHistorySource
    at: string
  }>
  /** The newest 20. */
  events: Array<{
    type: string
    receivedAt: string
    processedAt: string | null
    error: string | null
  }>
}

/** One plan on the staff plans screen. */
export interface StaffPlan {
  id: string
  key: PlanKey
  name: string
  description: string
  version: number
  entitlements: Record<string, EntitlementValue>
  prices: Array<
    PriceView & {
      active: boolean
      createdAt: string
      retiredAt: string | null
      subscribers: number
    }
  >
  tenantCounts: Record<BillingState, number>
}

/** `GET /platform/plans`. */
export interface StaffPlans {
  plans: StaffPlan[]
  catalog: EntitlementCatalogEntry[]
  priceWarningAboveMinor: 1500000
}

/** `POST /platform/plans/:id/preview`: what a plan edit changes and who it touches. */
export interface PlanChangePreview {
  changes: Array<{
    key: string
    from: EntitlementValue
    to: EntitlementValue
    direction: 'increase' | 'decrease'
  }>
  affected: { trialing: number; active: number; past_due: number; free: number }
}

/** `GET /platform/billing-settings`. */
export interface BillingSettings {
  trialEnabled: boolean
  trialDays: number
  pastDueGraceDays: number
  version: number
  updatedAt: string
  updatedBy: { userId: string; name: string } | null
}

/** One row of `GET /platform/billing/alerts`. */
export interface BillingAlert {
  id: string
  kind: BillingAlertKind
  tenant: { id: string; name: string } | null
  message: string
  at: string
}

/** `code` on the 402 for a write the plan's limit refuses. `details` is `{ key, used, limit }`, and absent when an invitee's join is refused. */
export const PLAN_LIMIT_REACHED = 'PLAN_LIMIT_REACHED'

/** `code` on the 402 for a feature the plan does not include. `details` is `{ key }`. */
export const PLAN_FEATURE_REQUIRED = 'PLAN_FEATURE_REQUIRED'

/** `code` on the 409 for a plan or billing settings edit made against a version another staff member replaced. */
export const PLAN_VERSION_CONFLICT = 'PLAN_VERSION_CONFLICT'
