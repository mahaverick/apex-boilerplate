/**
 * @file The staff half of the billing API contract
 * (docs/2026-10-24-billing-api-contract.md §1 and §5), as the server sends
 * it. Apex's own subset of react's `billing.types.ts`, whose text it copies:
 * apex reads no customer billing route, so the checkout, invoice, plan-page
 * and upgrade-request types stay react's. Money is integer minor units
 * (paise) plus `currency`; timestamps are ISO 8601 UTC strings.
 */

/** The plans the API serves. */
type PlanKey = 'free' | 'paid'

/** Where a workspace is in its billing lifecycle, in express's order. */
const BILLING_STATES = ['trialing', 'free', 'active', 'past_due'] as const

/** Where a workspace is in its billing lifecycle. `trialing` and `active` and `past_due` are all on Paid. */
type BillingState = (typeof BILLING_STATES)[number]

/** How often a Paid subscription charges. */
type BillingInterval = 'month' | 'year'

/** A catalog entry is an on/off feature or a numeric limit. */
type EntitlementKind = 'feature' | 'limit'

/** One entitlement the catalog names, with the wording the app shows for it. */
interface EntitlementCatalogEntry {
  key: string
  kind: EntitlementKind
  label: string
  description: string
}

/** A plan's value for one entitlement: a feature is a boolean, a limit is a number, and `null` is unlimited. */
type EntitlementValue = boolean | number | null

/** One price of a plan. */
interface PriceView {
  id: string
  interval: BillingInterval
  amountMinor: number
  currency: 'INR'
}

/** One plan on the staff plans screen. */
interface StaffPlan {
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

/** `code` on the 402 for a write the plan's limit refuses. `details` is `{ key, used, limit }`, and absent when an invitee's join is refused. */
export const PLAN_LIMIT_REACHED = 'PLAN_LIMIT_REACHED'

/** `code` on the 402 for a feature the plan does not include. `details` is `{ key }`. */
export const PLAN_FEATURE_REQUIRED = 'PLAN_FEATURE_REQUIRED'
